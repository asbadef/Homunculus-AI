# Group 1 · G1-16 — the demo and every legacy mode leave the dashboard; only the live UI remains — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After this plan the dashboard is one product: the live UI (`src/live/`) on the real API, plus the design gallery (`?tasarim=1`), and nothing else. The simulation (`?demo=1`, `#/demo`), the previous live workspace (`?eski=1`, which does not know about the lock screen), the replay (`?mode=replay`, `?scenario=`) and the legacy bearer-token board (`?board=1`) are deleted with every module only they reached, plus 13 modules that nothing reaches today. That is 80 files and 29,287 lines. An old bookmark or a tablet icon installed before Wave 2 opens the live system and loses its retired parameter from the address bar. A new test makes "every module under `src/` is reachable from the page" a rule. The build loses its 500 kB warning, and the service worker stops precaching anything that is not the live system. **Before anything is deleted, the old workspace's opt-in alarm sound and its background critical-alarm notification are ported into the live UI** (Tasks 4–5, the user's decision of 13.10). They go on through the new lock screen, a locked PC's notification names no bed, and the end of the session stops them. G1-15 (the end-to-end gate) then walks a tree with no second UI in it.

**Architecture:** One new folder, `src/live/signals/`: the alarm sound and the notification (Tasks 4–5): a tested rule (`signals.js`), the sound engine ported from `clinicalAudio.js` (`alarmSound.js`), and a provider mounted outside the session's phases (`AlarmSignals.jsx`), with a Settings tab for the opt-in. Nothing else is new. `main.jsx` keeps its shape (`chooseMode` → `pickRoot` → `AppShell` + `LoadBoundary`) and loses every branch but `live` and `tasarim`. It gains one pure function, `withoutRetired(location)`, run once at load before anything renders. A new test, `src/reachable.test.js`, walks the import graph from `main.jsx` with the reader the repo already has (`src/live/imports.testutil.js`, shared with `boundaries.test.js` and `routing.test.js`) and fails on any production module it cannot reach. That test drives the deletions: a removal that leaves an orphan behind fails it. The four framework-free API modules outside `src/live/` (`backendApi.js`, `liveAuth.js`, `liveAdapters.js`, `liveConnection.js`) and `LoadFailed.jsx` stay where they are.

**Tech Stack:** React 18.3, Vite 5.4, vite-plugin-pwa 1.3, Tailwind 3.4, Vitest 2.1 + Testing Library on jsdom 24. **No new package and no package removed** (Decision 13). The only Python changes are comments, in two engine files (Task 9).

**Inputs:**
- **Roadmap:** `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md`. The G1-16 row (line 117) and D1 (line 55). Every other mention, found with `grep -n "G1-16"`: lines 184 (the tablet icon), 192 and 743 (`?eski=1` and the lock), 272–274 (the first chunk's split), 509 and 512 (`simulationGating`), 538 (manifest), 732–735 (precache), 778 (`/notifications`).
- **Binding patterns:** `/c/tmp/homunculus-plans/amendments.md`, especially "D1 holds", "`importsOf`/`staticImportsOf` live in `src/live/imports.testutil.js`" and the Wave 2 notes on `legacyRoots` and the precache.
- **Deferred items:** `/c/tmp/homunculus-plans/deferred.md`. The `/notifications` heartbeat note is answered in Decision 12.
- **Model plans:** Wave 3B (`2026-10-12-g1-dalga3b-yonetim-ekranlari.md`) for the form, Wave 2 (`2026-10-04-g1-dalga2-kabuk-giris.md`) for `pickRoot`.

---

## Read this before Task 1

**The base is `feat/canli-tasarim` at `69f059f`, measured:** dashboard **108 files / 2430 tests**, all green, in about 40 s. `npx vite build` is clean apart from the known `(!) Some chunks are larger than 500 kB` (that chunk is `legacyRoots`). The precache holds **22 entries**. Every number below is a delta from that base, with the absolute value in brackets. Task 0 prints the base you actually have.

**The branch moved twice while this was written, and the plan was re-measured for it.** It was first measured at `e4cdf15` (108 / 2415). The final review's fast-forward to `69f059f` added 15 tests: `backendApi.test.js` 100 → 103 and 12 in the live admin tabs. It touched none of the 80 files this plan deletes, none of the 22 it edits for the removal, and none of the 7 the port edits (checked with `git diff e4cdf15 69f059f`), so **every per-task delta is the same at both bases**. Only the absolute values moved, and `LiveApp`'s size. One more commit, `126a011`, landed before this was finished. It changes admin strings, `ScopeEditor.jsx` and the Turkish guide: the suite is still **108 / 2430**, all 26 document anchors of Task 9 still occur exactly once, and the build differs only in `Toast-*`, 178.53 / 65.48 kB instead of 178.25 / 65.28. `backendApi.js` gained `setScope`'s optional third argument, `expected_grants`, in that range. It stays (see "Keep").

**Every task was replayed before this was written — the removal four times, the port twice.**
- **At `e4cdf15`** (`/c/tmp/g116plan/wt`): the removal's code was developed there.
- **At `69f059f`, from this document's own text** (`/c/tmp/g116plan/wt2`): every `replace … with …` pair applied with the Edit tool, every file given whole extracted from this document by script, the suite **and** a production build after each task.
- **At `126a011`, with the port inserted** (`/c/tmp/g116plan/wt3`): Tasks 1–3 replayed from this document, then Tasks 4–5 developed there test-first (every red observed), then Tasks 6–8 replayed on top, with the suite and a build after each.
- **At `126a011` again, the whole of Tasks 1–8 from this document's text alone** (`/c/tmp/g116plan/wt4`): every created file extracted, every pair applied by script. The resulting dashboard is byte-identical to `wt3`'s (`diff -rq`, line endings aside), and the counts it printed are the ones in the gates.

The `e4cdf15` and `69f059f` trees are identical except for the ten files `69f059f` itself changed. **Every "Expected" line is what a replay printed**, red runs and intermediate states included: Tasks 0–3 at `69f059f` and at `126a011` alike (the counts agree), Tasks 4–8 at `126a011`. The 26 markdown anchors of Task 9 were checked to occur exactly once at `69f059f` and again at `126a011`. The diff of the first replay is in `/c/tmp/g116plan/g116-replay.patch`, for reference only. Never `git apply` it: it is one uncommitted diff, not seven commits, and a task's commit must contain exactly that task.

**The deletions look irreversible. They are not, and nothing here is deployed.**
- Every file this plan deletes is unchanged between `e4cdf15` and `69f059f`, and both commits are ancestors of `origin/feat/canli-tasarim` (`126a011` when checked). `git show e4cdf15:dashboard/src/<file>` reads any of them back, and `git checkout e4cdf15 -- dashboard/src/<file>` restores one. The documents and comments this plan writes cite `e4cdf15` for that reason.
- Nothing on this branch is on the hospital VM. The user's standing decision (2026-10-07) is that nothing goes to the VM until all of Group 1 is through its gate. The VM still runs `feat/infinity-production-integration` (`538ba54`), which has its own copy of every deleted file.
- `origin/main` (`2f3544a`) is an ancestor of `69f059f` (checked with `git merge-base`). A later merge of this branch into main therefore meets no modify/delete conflict on any file deleted here.
- The public Vercel deployment is not touched by anything in this plan. Taking it down is the user's job (**Needs the user, 1**).

**The main checkout has uncommitted work that this plan will collide with later. Do not touch it.** `/c/Users/User/Desktop/Project/Homunculus AI` is on another branch (`feat/ldap-rbac`). It holds uncommitted edits to `dashboard/src/main.jsx`, `dashboard/src/routing.test.js` and `dashboard/vite.config.js` for an `?infinityTest=1` view, plus untracked `InfinityPreview` / `InfinityBeds` files. That work is not on this branch and this plan does not read it. **Whoever later brings `?infinityTest=1` across will meet a conflict**, because this plan rewrites the same three places:
- **`main.jsx`.** `chooseMode` returns only `"live"` or `"tasarim"`, `pickRoot` has two branches, `AppShell` no longer takes `mode`, and `withoutRetired` runs at load. Their mode goes into `chooseMode`, decide whether `?live=1` still wins over it, and give it its own `React.lazy` branch in `pickRoot`. Do **not** reintroduce a static import: the first chunk is pinned.
- **`routing.test.js`** is rewritten whole (Task 6). Its test "reaches the live UI and the design gallery lazily, and nothing else" pins the exact lazy imports. Adding their view is a deliberate one-line change to that list, and it is meant to be.
- **`vite.config.js`.** The workbox `globIgnores` and its comment are rewritten (Task 8). If their edit touched the proxy list or the precache, merge by hand.
- **`src/reachable.test.js` (new) fails on any module under `src/` that `main.jsx` cannot reach.** Their files must be reached through their lazy import. And if their `InfinityBeds`/`InfinityPreview` import anything this plan deletes, they must be ported to `src/live/ui` or the deleted module restored on purpose; the net and the build will name which. This branch's own `src/InfinityBeds.jsx` imported `clinicalUi.jsx`, and both are deleted in Task 1.

**Two capabilities would have left with the old workspace; the user decided they come across first (13.10).** The previous workspace, live mode included, had an opt-in **alarm sound** (`clinicalAudio.js`, IEC 60601-1-8 burst patterns by tier) and a **browser notification for a new critical alarm while the tab is hidden** (`ClinicalDemo.jsx` 4242–4320). The build the VM runs today (`538ba54`) has both; the new live UI had neither. **Tasks 4 and 5 port them, and they come before Task 6, which deletes their last copy.** Task 4 says, from the code, exactly what the old build does. The reachability net makes the code one task: a rule and an engine nobody mounts fail it. What is new is what the old build never had to decide, having no lock screen: the alarm keeps sounding through a lock, and a locked PC's notification names no bed.

---

## Size, counts and the build

**10 tasks after the baseline. Honestly 10–12 hours of subagent execution including review.** The removal is mostly deletion and the Turkish documents; the port (Tasks 4–5) is new code with 36 tests, and its browser look is the user's. The roadmap scores G1-16 at 3 points (≈ half a day), which assumed the deletion list in the row. The import graph is two and a half times that list, but `reachable.test.js` makes the size mechanical rather than risky. The port was not in the row at all.

| Task | Hours | What |
|---|---|---|
| 0 — Baseline | 0.25 | Worktree, counts, build sizes, commit the plan |
| 1 — The reachability net, and the 13 modules nothing reaches | 0.75 | TDD: the net is red on 13 modules plus one comment, then green |
| 2 — Replay and the legacy board | 1.0 | TDD on the URL: `withoutRetired` is born; 11 modules, 9 test files and the 5 replay scenarios deleted |
| 3 — Two kept tests stop reading `permissions.js` | 0.25 | No count change |
| 4 — The alarm sound and the critical-alarm notification, ported | 3.0 | TDD: the rule, the engine, the provider outside the phases; through the lock, out at the session's end; 32 tests |
| 5 — The opt-in, in Settings | 1.0 | TDD; 4 tests; a browser look at a real speaker (the user's) |
| 6 — The simulation and the previous workspace | 1.25 | TDD on the URL again; `legacyRoots` and 30 more files deleted, `clinicalAudio.js` among them; stale comments in 9 kept files |
| 7 — The adapter's seconds-unit `ack.atSec` | 0.5 | TDD: the field the adapter's own comment promised to G1-16 |
| 8 — Leftovers: precache, Tailwind palette, `index.html` | 0.75 | TDD on the config files |
| 9 — The documents, and two engine comments | 2.5 | Roadmap, Turkish guide (the sound included), three deploy docs, the spec, amendments/deferred |
| 10 — Final verification | 0.5 | Suite twice, build, greps |

**Counts** (dashboard; each task's own file numbers are in its gate; the same at `69f059f` and `126a011`):

| After | Files | Tests | Δ files / tests | What moved |
|---|---|---|---|---|
| Task 0 (base) | 108 | 2430 | — | — |
| Task 1 | 98 | 2312 | −10 / −118 | `reachable.test.js` **+3**; 11 test files deleted (−121) |
| Task 2 | 89 | 2279 | −9 / −33 | 9 test files deleted (−38); `legacyRoots.test.jsx` 4 → **2**; `routing.test.js` 17 → **24** |
| Task 3 | 89 | 2279 | 0 / 0 | `liveAuth.test.js` 16, `live/shell/routes.test.js` 22, both unchanged |
| Task 4 | 92 | 2311 | +3 / +32 | `signals.test.js` **8**, `alarmSound.test.js` **9**, `AlarmSignals.test.jsx` **14**, `LiveApp.test.jsx` 35 → **36** |
| Task 5 | 92 | 2315 | 0 / +4 | `SettingsScreen.test.jsx` 4 → **8** |
| Task 6 | 75 | 1781 | −17 / −534 | 17 test files deleted (−534); `routing.test.js` 24 → **24** (rewritten) |
| Task 7 | 75 | 1781 | 0 / 0 | `liveAdapters.test.js` 50 → **50** (one assertion rewritten) |
| Task 8 | 75 | **1782** | 0 / +1 | `devProxy.test.js` 4 → **5**; `tailwind.test.js` 12 → **12** |
| Tasks 9–10 | 75 | 1782 | — | documents; engine `tests/test_nginx_routes.py` **40 passed** (3.12) |

The removal's deltas were first measured at `e4cdf15` (2415 → 1731, before the port existed) and are the same.

**`src/live/` moves only for the port: 62 files / 1504 tests until Task 3, 65 / 1540 from Task 5 on, and no deletion takes anything from it.** That is the measurement that D1 held: nothing in the new UI leaned on anything deleted here. Outside `src/live/`: 46 files / 926 tests → 10 files / 242.

**The build** (`npx vite build`, kB as Vite prints them, raw / gzip; Tasks 0–3 measured at `69f059f`, Tasks 4–8 at `126a011`):

| After | First chunk `index-*` | `LiveApp-*` | `Toast-*` (shared by LiveApp and the gallery) | Others | CSS `index-*` | 500 kB warning | Precache |
|---|---|---|---|---|---|---|---|
| Task 0 | 147.28 / 48.18 | 160.83 / 46.68 | 178.25 / 65.28 (178.53 / 65.48 at `126a011`) | `legacyRoots` 529.36 / 165.88, `browser` 37.99 / 14.80, `DesignGallery` 8.61 / 2.79 | 69.25 / 12.71 | **yes** | 22 entries (785 KiB) |
| Task 1 | same | same | same | same | 65.61 (raw) | yes | 22 (781 KiB) |
| Tasks 2, 3 | 147.58 / 48.32 | same | same | `legacyRoots` 511.81 / 160.59; no `demo/` in `dist` | 62.27 (raw) | yes | 22 (778 KiB) |
| Task 4 | 147.58 / 48.32 | 166.00 / 48.56 | 179.91 / 66.04 | as Task 2 | 62.32 / 11.73 | yes | 22 (785 KiB) |
| Task 5 | same | 168.03 / 49.03 | 186.00 / 68.41 | as Task 2 | 62.32 / 11.73 | yes | 22 (794 KiB) |
| Task 6 | 146.74 / 48.02 | 205.17 / 63.22 | 186.00 / 68.41 | `DesignGallery` 8.61 / 2.79; no `legacyRoots`, no `browser` | 28.84 / 6.77 | **no** | 21 (760 KiB) |
| Task 7 | same | 205.05 / 63.20 | same | same | same | no | 21 |
| Task 8 | 146.74 / 48.02 | 205.05 / 63.20 | 186.00 / 68.41 | `DesignGallery` (not precached) | 28.84 / 6.77 | no | **20** (751 KiB) |

The CSS shrinks at every deletion, Task 1 included, although none of Task 1's modules was bundled: Tailwind scans `src/**` for class names whether or not a file is imported. The port adds about 7 kB to `LiveApp` (the provider and the engine) and 8 kB to `Toast` (its four-language texts ride with the shared i18n chunk). `browser-*` was the code `LiveApp` shared with `legacyRoots`: qrcode plus the four API modules. With `legacyRoots` gone, Rollup folds it into `LiveApp`, which is why `LiveApp` grows by 37 kB at Task 6 while the JavaScript total falls by about 515 kB (1062 → 546 kB, half). The precache's KiB figure moves by a few KiB between two builds of the same tree. The **entry count** is the number to compare.

**The first chunk is not split, and does not need to be** (Decision 6). The roadmap made splitting G1-16's job if the first chunk passed about 250 kB gzip. It is **48 kB gzip**, about 94 % React. The 500 kB warning belonged to `legacyRoots` and goes with it. **Budget, enforced at Tasks 6, 8 and 10:** no chunk over 500 kB (Vite prints no warning); `index-*.js` ≤ 150 kB raw and ≤ 50 kB gzip; the precache holds 20 entries; `dist/` holds no `legacyRoots-*`, no `browser-*` and no `demo/`. `routing.test.js` pins what `main.jsx` imports statically, so the first chunk's content cannot grow by accident.

---

## How this plan was checked, so you know what to trust

**Run, not reasoned.** Every task was applied in order **from this document's text** (the `wt2` and `wt4` replays). Red runs were run before the fix: Task 1's net at HEAD, and again after the comment fix alone; Task 2's and Task 6's routing tests against the previous `main.jsx`; Task 4's rule and engine tests with no module; the net naming the two unmounted modules; the provider's test with no provider; the LiveApp test with the provider not mounted; Task 5's Settings tests with no tab; Task 7's adapter test; Task 8's two config tests. The build was run after every task, Task 3's included. Each "Expected" line is the printed result. Nothing in a gate is derived.

**The port's tests were mutated against its code** (Task 4 Step 8). A lock that silences the sound, a session's end that does not stop it, and a missing gesture listener each fail tests. A lock that kept a bed-naming notification at first failed none, because on a LIVE board another branch closes it anyway. The lock test now runs over a dropped stream, and that mutation fails it.

**What the replays corrected in earlier drafts of this document:**
- Task 7's check `grep "atSec"` would also have found the new comments that explain the removal, and the test's own `not.toHaveProperty("atSec")`. It now greps for the code forms only.
- Task 10's "nothing names a removed mode" grep printed `main.jsx`'s own comments, which name the retired addresses on purpose. It now leaves out the four files that do so by design.
- The build table said the CSS did not move until the main deletion. It moves at every deletion: Tailwind scans files nobody imports.
- A fresh worktree checks out **CRLF** (`core.autocrlf=true`), documents included, while `/c/tmp/homunculus-g1` happens to hold LF. A script matching this document's LF blocks against a fresh checkout finds none of the multi-line ones; the Edit tool finds all of them. That is one more reason for the Write/Edit rule.

**Found by running, and not visible by reading:**
- **The repo's own import reader misread a comment.** `legacyRoots.jsx` line 5 says "behind one lazy import (main.jsx)", and `importsOf` reads `import (` as a dynamic import it cannot follow. `boundaries.test.js` never saw it because it walks `src/live/` only. The new net walks the whole page, saw it at once, and Task 1 rewords the comment. Write no `import (` and no `import "x"` into a comment under `src/`.
- **The deletion list in the roadmap row names 6 modules. The import graph removes 38 production modules and 37 test files.** 13 of the 38 are reachable from nothing today: they were "kept, not connected" as references for Groups 2–4 (roadmap, "Bu dal VM'ye çıkmaz"). 25 are reachable only through `legacyRoots.jsx`.
- **The live board store reads the adapter's `ack` as its "acknowledged" flag** (`live/data/boardStore.js:462`, `needsAnswer = (a) => !a.ack && …`). So `ack` cannot go, although the adapter's comment said it would "go with the workspace G1-16 deletes". Only the seconds-unit `atSec` inside it goes (Task 7).
- **The mobile app reads `/notifications`** (`homunculus-mobile/src/transport/sseTransport.ts:254`). The deferred note that it "goes with G1-16" was wrong: the route stays.

**What was NOT run:** a browser, and a speaker. There is no browser driver on this machine. The URL fallbacks are tested in jsdom, `history.replaceState` included. Opening `/?demo=1`, `/#/demo`, `/?eski=1` and `/?board=1&token=x` on the local stack and watching the bar is Task 10's optional last step. The alarm sound is tested against a fake Web Audio that records every tone, and the notification against a fake `Notification`. **Whether a ward PC's speaker actually sounds, and whether Windows shows the notification, nobody has checked** (Task 5 Step 5, the G1-15 gate, **Needs the user, 3**).

---

## What the import graph says: remove, keep, move

Built with `importsOf` (the repo's reader) over all 261 files under `dashboard/src` at `e4cdf15`. The graph is the same at `69f059f`: no file was added or removed in between, and no import line changed in any file the graph classifies. Every relative import, `vi.mock` and `vi.importActual` was resolved; none was unresolvable, and every relative import carries its extension. **145 production modules; 132 reachable from `main.jsx`; 107 after G1-16. Every one of those 107 is reachable** (`reachable.test.js` green), and they are all of `src/live/` plus the seven below.

### Remove: 38 production modules, 37 test files, 5 data files

**Reachable from nothing today (Task 1).** Each of these imports the simulation or the old UI kit, or is imported only by its own test:

| Module | Imports | Its test (tests) | What it was, and where that went |
|---|---|---|---|
| `wallBoard.jsx` | `clinicalDemo.js`, `clinicalUi.jsx`, `patientScope.js` | `policySettings.test.jsx` (13) | Wall monitor and name-masking policy → Group 2 |
| `rrtQueue.js` | `clinicalDemo.js` | `rrtQueue.test.js` (11) | RRT queue → Group 2 |
| `alarmDensity.js` | — | `alarmDensity.test.js` (11) | Alarm heat map → Group 2 |
| `severityScore.jsx` | `clinicalUi.jsx` | `severityScore.test.jsx` (10) | SOFA form and signing → Group 2 (user decision, Wave 3) |
| `clinicalAdmin.jsx` | `clinicalDemo.js`, `clinicalUi.jsx` | `alarmQualityPanel.test.jsx` (7), `auditIntegrity.test.jsx` (6) | Alarm quality → Group 4; audit integrity → Group 2 |
| `InfinityBeds.jsx` | `clinicalUi.jsx` | `InfinityBeds.test.jsx` (9) | Device health → Group 4 |
| `admissionPage.jsx` | `clinicalDemo.js`, `clinicalUi.jsx`, `liveAdapters.js`, `patientLabel.js` | — | Admission / transfer / care team → Group 2 |
| `patientLabel.js` | — | `patientLabel.test.js` (15) | Barcode label → Group 2 |
| `patientScope.js` | — | `patientScope.test.js` (15) | Screen scope → done on the server (G1-12, Wave 3B 14a) |
| `feedHealth.js` | — | `feedHealth.test.js` (22) | Copied to `live/screens/common/feedHealth.js` (G1-09) |
| `risk.js` | — | `risk.test.js` (2) | Superseded by `pillRisk` (`screens/common/BoardState.jsx`) |
| `clinicalUi.jsx` | `clinicalI18n.js`, `clinicalDemo.js` | — | The old UI kit → `src/live/ui` |
| `loginHero.jsx` | — | — | The old sign-in screen's animation; the D4 sign-in has none |

**Reachable only through the replay and the legacy board (Task 2):** `Board.jsx`, `demo.jsx`, `demoTransport.js`, `api.js` (the bearer-token client, `/notifications?token=`), `i18n.js`, `theme.js`, `notifications.js` (desktop notification and beep), `Toasts.jsx`, `PatientDetail.jsx`, `PatientList.jsx`, `NotificationHistory.jsx`. Their tests are `Board.test.jsx` (7), `demo.test.jsx` (1), `demoTransport.test.js` (5), `i18n.test.jsx` (5), `notifications.test.js` (3), `Toasts.test.jsx` (3), `PatientDetail.test.jsx` (10), `PatientList.test.jsx` (2) and `NotificationHistory.test.jsx` (2), 38 tests in all. The data files are `public/demo/{news2_deterioration,news2_partial_nce_only,septic_shock,stable_control,under_resuscitated}.json`. I checked that nothing on the simulation's side imports any of these.

**Reachable only through the simulation and the previous workspace (Task 6):**

| Module | Its tests (tests) |
|---|---|
| `legacyRoots.jsx` | `legacyRoots.test.jsx` (2 after Task 2) |
| `ClinicalDemo.jsx` (4460 lines) | `ClinicalDemo.rbac.test.jsx` (43), `nav.test.js` (6) |
| `clinicalDemo.js` (2428 lines; the simulation and its demo users) | `clinicalDemo.test.js` (123) |
| `liveStore.js` (the old live store, built over the simulation) | `liveStore.test.js` (48), `liveStore.live.test.js` (47), `liveStore.admin.test.js` (25), `auditFromEngine.test.js` (12), `clinicalCharting.test.js` (6), `scopeAssignment.test.js` (3) |
| `clinicalI18n.js` (3644 lines) | `i18n.rbac.test.js` (109) |
| `liveAdmin.js` | `liveAdmin.test.js` (28) |
| `admin/LiveUserAdmin.jsx`, `admin/GroupAdmin.jsx`, `admin/LiveStaffTab.jsx` | `admin/LiveUserAdmin.test.jsx` (35), `admin/GroupAdmin.test.jsx` (20) |
| `permissions.js` | `permissions.test.js` (14) |
| `ui.jsx` | `ui.test.jsx` (9) |
| `clinicalTheme.js` | — |
| `clinicalAudio.js` — **ported first** (Task 4, `live/signals/alarmSound.js`, its numbers unchanged) | — |
| `DemoDataBanner.jsx` | `DemoDataBanner.test.jsx` (4) |

That is 17 test files and 534 tests. **Everything these tests guarded is either rebuilt under `src/live/` or routed to a group**; the roadmap table is in Task 9 Step 5. Two guarantees that look lost are not. `i18n.rbac.test.js`'s "every server message is translated" is held, file for file and wider, by `live/apiErrors.test.js` (137 tests; it also reads both nginx 429 texts and `admin/service.py`'s `UNKNOWN_GROUP`). `permissions.test.js`'s parity with `auth/permissions.py` is held for the keys, the group slugs, `is_system`, `mfa_required` and `kind` by `live/screens/admin/catalogue.test.js`. Only the parity of each default group's **rights** is lost. The dashboard never needs those at run time (the token carries a session's rights), and the one kept test that used them now reads `permissions.py` itself (Task 3).

### Keep: 7 modules outside `src/live/`, with evidence

| Module | Who imports it after G1-16 | Why it stays, and what does not change |
|---|---|---|
| `main.jsx` | `index.html` | The entry. Rewritten (Tasks 2 and 4). |
| `LoadFailed.jsx` | `main.jsx` (static, first chunk) | The last resort when a root will not load. Its texts live here on purpose: the dictionary is in the chunk that failed. |
| `index.css` | `main.jsx` | `<body>`'s colours and font: what `LoadFailed` is drawn in when the live UI's own stylesheet failed. |
| `backendApi.js` | `live/LiveApp.jsx`, `live/session/sessionStore.js`, `live/screens/admin/SourceTab.jsx` | The API client, one of `boundaries.test.js`'s four `ALLOWED` modules. It is still changing: Wave 3B's final review gave `setScope` an optional third argument, `expected_grants` (`a301c73`, `d9bb996`). Five methods were called only by the old workspace (`alarmQuality`, `verifyAudit`, `severityForm`, `signSeverityForm`, `setProfile`). They stay, tested (`backendApi.test.js` 103, `backendApi.admin.test.js` 17), for their Group 2–4 screens. |
| `liveAuth.js` | `live/session/sessionStore.js` | Token reading. Its test changes import (Task 3). |
| `liveAdapters.js` | `live/data/boardStore.js` | Board payload → patients and alerts. `ack.atSec` goes (Task 7). `bedsFromPatients`, `ageFromBirthDate` and `awaitingLocalAdmission` are used by no live screen but **stay**: the roadmap moved main's admission contracts into `liveAdapters.test.js` (50) on purpose, as Group 2 acceptance criteria ("Main'den gelen ve yeni kabukta karşılanacak davranışlar"). Reachability is per module, so the net does not flag an unused export. |
| `liveConnection.js` | `live/data/boardStore.js`, `BedsScreen`, `BoardState`, `Shell`, `TopBar` | The connection state machine. |

Their tests stay: `backendApi.test.js`, `backendApi.admin.test.js`, `liveAuth.test.js` (edited), `liveAdapters.test.js` (edited), `liveConnection.test.js`, `sepsisContext.test.js` (6; imports `backendApi.js` and `liveAdapters.js` only), `LoadFailed.test.jsx` (4), `devProxy.test.js` (edited), `routing.test.js` (rewritten), plus the new `reachable.test.js`. **Ten test files outside `src/live/` after G1-16: 242 tests.**

### New: 8 files, the port (Tasks 4–5)

`src/live/signals/`: `signals.js` (the rule) + test, `alarmSound.js` (the engine) + test, `AlarmSignals.jsx` (the provider) + test, `fakeAudio.testutil.js` (test-only); and `src/live/i18n/strings/signals.js`. The page reaches all of them through `LiveApp.jsx` (the net checks it). The old workspace's sound and notification lived in `clinicalAudio.js` and inside `ClinicalDemo.jsx`'s root (its top bar and two effects); nothing of that code is imported.

### Move or rename: none

The four API modules could move under `src/live/`. They do not (Decision 8): about 20 importers and 6 test files would churn for no change in behaviour, `boundaries.test.js`'s `ALLOWED` list already names them as the boundary, and the move would widen the conflict with the main checkout's `?infinityTest=1` work.

### The tests that import something removed, and stay

| Test | Imported | Task |
|---|---|---|
| `live/shell/routes.test.js` | `PERMISSION_KEYS` from `../../permissions.js` | 3: from `../screens/admin/catalogue.js` (the same 21 keys in the same order, held to `permissions.py`) |
| `liveAuth.test.js` | `DEFAULT_GROUPS` from `./permissions.js` (three groups' rights) | 3: read from `auth/permissions.py` as text |
| `legacyRoots.test.jsx` | `Board.jsx`, `demo.jsx` mocks | 2: those mocks and their two tests go; the file goes in 4 |
| `routing.test.js` | names the removed modes | 2 and 4 |
| `devProxy.test.js` | asserts the `legacyRoots` / `demo/**` globs | 6 |
| `live/theme/tailwind.test.js` | pins the old palette | 6 |
| `live/boundaries.test.js` | names `ClinicalDemo.jsx`, `liveStore.js` **as strings** in its reader's own test | none: they are fixtures for the reader, and stay |

### Every query parameter and hash the page honours, before and after

| Address | Before G1-16 (`69f059f`) | After G1-16 | The address bar after load |
|---|---|---|---|
| `/` | live UI | live UI | unchanged |
| `?live=1` | live UI, wins over everything but `#/demo` | live UI, wins over `?tasarim=1` | unchanged |
| `?tasarim=1` | design gallery | design gallery (no longer precached) | unchanged |
| `?demo=1` | the simulation (`ClinicalDemo` on the demo store) under the demo-data banner | live UI | `demo` removed |
| `#/demo…` | the simulation, **ahead of every query parameter, `?live=1` included** | live UI | the hash removed |
| `?eski=1` | the previous live workspace on the real API, **no lock screen** | live UI | `eski` removed |
| `?mode=replay`, `?scenario=<name>` | replay of `public/demo/<name>.json` under the banner | live UI | both removed (`mode` only when it is `replay`) |
| `?board=1`, `&token=…` | the legacy bearer-token board (default token `dev-token`; 401 forever on a real deployment) | live UI | `board` and `token` removed: a tenant credential leaves the bar and the history entry |
| `?mode=<anything else>` | live UI | live UI | unchanged: not this page's to take |
| `#/beds`, `#/alarms`, `#/patients/:id`, `#/admin`, `#/settings` | live UI routes | unchanged (`LiveApp` uses a deep link once; a patient is never reopened after sign-in) | unchanged |

Wave 2 fixed the manifest (`start_url: "/"`, `lang: "az"`; amendments, "From Tasks 23–26"). The roadmap then predicted that once `?demo=1` was deleted, an icon still opening it would show "the page could not be loaded" (`LoadFailed.jsx`). **This plan does better** (Decision 3): that icon opens the live system. `LoadFailed`'s "check your connection" would have been false.

### `vite.config.js`, the manifest, `index.html`, the precache

- **Manifest:** already right since Wave 2 (`start_url: "/"`, `lang: "az"`, an Azerbaijani description). The comment gains one sentence: an icon installed before then now opens the live system too.
- **`workbox.globIgnores`:** `["**/legacyRoots-*.js", "demo/**"]` → `["**/DesignGallery-*.js"]`. The two old patterns would match nothing after Tasks 2 and 4. The gallery leaving the precache is a roadmap item open since Wave 1B ("Galeri parçası (`?tasarim=1`) … hâlâ önbellekte → G1-16").
- **`index.html`:** `<html lang="tr" class="dark">`, `<title>Homunculus — Canlı Pano</title>` → `<html lang="az">`, `<title>Homunculus</title>`. `class="dark"` switched the old app's Tailwind `dark:` variants (only `ClinicalDemo.jsx` and `clinicalAdmin.jsx` used them). The live UI themes with `data-theme`, and `LiveApp` sets the title to `PRODUCT` = "Homunculus" anyway. `lang` is what the page says while nothing has loaded, and on `LoadFailed`.
- **`tailwind.config.js`:** `darkMode: "class"` and the `brand` / `sev` palettes go. After Task 6 only deleted files used them (`grep` found `Board.jsx`, `NotificationHistory.jsx`, `PatientDetail.jsx`, `Toasts.jsx`, `clinicalTheme.js`, `theme.js` and `liveStore.live.test.js`). `fontFamily.sans` stays, because `index.css` gives it to `<body>`.
- **No PWA leftover remains**, and `public/` keeps only `icon.svg`.

### Server side: nothing is deleted

| Candidate | Who uses it | Decision |
|---|---|---|
| `GET /notifications` (`api/app.py:794`) | The **mobile app** (`homunculus-mobile/src/transport/sseTransport.ts:254`); on the dashboard only the deleted `api.js` | **Keep.** Its missing heartbeat (deferred.md) → Group 5: mobile has no silence watchdog either. |
| Tenant-token access to `/patients`, `/stream` | The **bridge** (it is the `/ingest` credential); `tests/test_dual_credentials.py` | **Keep**: by design ("the clinical routes must accept either credential"). The legacy board was one more caller. |
| `homunculus/scenarios/*.yaml` + `loader.py` | Engine tests (`test_scenarios_e2e.py`, `test_scenario_*`, `test_api_*`, `test_dual_credentials.py`, …), `scripts/replay.py` | **Keep**: test fixtures, and `replay.py` feeds a local stack's live UI. |
| `scripts/record_demo.py` (+ `tests/test_record_demo.py`, `test_record_ward.py`) | Wrote `dashboard/public/demo/*.json` for the replay | **Keep for now**: it has tests and does no harm; deleting it is a Python change with a 2 × 12-minute suite → **Needs the user, 7** / Group 4. |
| Infinity replay (`edge/infinity_replay.py`, `scripts/serve_infinity_replay.py`) | The Infinity pilot | Not the dashboard's replay. Untouched. |

Two engine **comments** name `clinicalI18n.js` and are corrected in Task 9: the docstrings of two tests in `tests/test_nginx_routes.py`, and `src/homunculus/admin/service.py:106`. No Python test reads `service.py` as text (checked). `live/apiErrors.test.js` does, and stays green.

### Documents that mention the removed modes (Task 9)

- **The roadmap:** sixteen places (Task 9 Step 3).
- **`docs/homunculus-rehber-TR.md`:** four passages and one new entry.
- **`docs/DEMO-DEPLOY.md`:** the whole document is the demo; it becomes a short note.
- **`docs/DEPLOY-SUPABASE.md`:** the "public demo" lines.
- **`docs/EDGE-BRIDGE-LOCAL.md`:** "What the dashboard shows in Phase 1" still says "the simulation, and carries a banner".
- **`docs/superpowers/specs/2026-09-23-ldap-rbac-design.md`:** §8 and line 357, as-built notes.
- **`/c/tmp/homunculus-plans/{amendments,deferred}.md`.**
- **`README.md` is untouched:** it names no mode.
- **Historical plans and specs are untouched:** they are the record of their time.

---

## Not in this plan

- **Removing an npm package.** `lucide-react` is unused after Task 6 (`grep` finds no importer), and Vite tree-shakes it, so it costs no bytes. Removing it means `npm uninstall` against the `node_modules` junction every G1 worktree shares. The worktrees at older commits (`/c/tmp/w3b-*`) still import it. → a deliberate package-hygiene commit, Group 4.
- **Trimming `liveAdapters.js` to what the live UI reads.** The old alert fields (`tier`, `firedAtSec`, `currentStep`, `events`, `snooze`, `mutedUntil`, `auto`, `trigger`) and the three unused exports stay, pinned by their tests, until a screen needs them changed (Decision 9). Only `ack.atSec` goes (Task 7).
- **Any engine route, flag or script** (see "Server side").
- **The public Vercel and Render deployments and their repo files** (`vercel.json`, `render.yaml`, `dashboard/.env.production`, `docs/DEPLOY-SUPABASE.md`). They describe a deployment that exists until the user takes it down (**Needs the user, 1**).
- **Beyond the port, nothing new for alarms.** No push service, so no notification from a closed tab; the old banner's claim that there was one is not ported. No sound control in the top bar (the old build had one), and no snooze (the live system has none). A sound indicator in the shell is a design question (**Needs the user, 4**).
- **The VM.** Nothing here deploys, pushes or touches `/c/Users/User/Desktop/Project/Homunculus AI`.

---

## Decisions

Each carries the alternative it rejected.

1. **The 13 modules nothing reaches are deleted, not kept as references for Groups 2–4** — confirmed by the user (13.10): git history keeps them. This is forced rather than preferred. Seven of them import `clinicalDemo.js` or `clinicalUi.jsx`, and `clinicalUi.jsx` imports `clinicalI18n.js`, so keeping them means keeping the simulation and the old dictionary: the two largest things G1-16 exists to remove. The other six (`risk`, `patientLabel`, `patientScope`, `feedHealth`, `alarmDensity`, `loginHero`) import nothing. Kept, they would be exactly what Decision 2 forbids: green tests over code no screen runs. Three of them are already rebuilt under `src/live/` or on the server. Every one is readable at `e4cdf15`, and the roadmap's table (Task 9) names each module's target group and the command that reads it. *Rejected:* keeping them (they would drag the simulation along, and they are written against the old UI kit, so Group 2 would rewrite them anyway); exempting the import-free six from the net (an exemption list is a "kept, not connected" list with a different name).

2. **A test makes "everything under `src/` is reachable from the page" a rule, and that test drives the deletions.** `src/reachable.test.js` walks from `main.jsx` with `importsOf`, the reader `boundaries.test.js` and `routing.test.js` already share. It fails on anything it cannot follow and on any production module it does not reach. Each removal task deletes a root and must then delete everything only that root reached, or the net names the orphans. The project calls its own worst failure "written, tested, never connected" (`patientScope.js` says it of itself), and 13 modules were in that state today. *Rejected:* deleting by the roadmap's list (it names 6 of 38; the rest would have stayed as orphans with green tests); a one-off audit (the next "kept for later" module would pass every test again).

3. **Every retired address opens the live system and loses its retired parameter at load.** `withoutRetired(location)` is a pure function, tested. It returns the address without `demo`, `eski`, `board`, `token`, `scenario`, without `mode` when it is `replay`, and without a `#/demo` hash; or it returns `null` when there is nothing to take. `main.jsx` calls it once and does a `history.replaceState` before anything renders. This matters because `LiveApp` keeps `location.search` whenever it clears the hash, so a retired parameter would otherwise stay in the bar all session. `#/demo` is matched as a whole path segment (`#/demographics` is left alone). `mode` is taken only as `replay`: the roadmap gives the Group 2 wall display a "kiosk mode", and a `?mode=kiosk` must not be eaten by a cleanup written today. *Rejected:* a "page not found" or `LoadFailed` for a retired address (the Wave 2 prediction; a ward tablet's icon would show an error, and `LoadFailed` says "check your connection", which would be false); leaving the parameter (the bar reads `?demo=1` above real patients, and `?board=1&token=…` keeps a tenant credential in the address and history); a "the demonstration was removed" notice (four-language copy and a way into a session that may already be open, for an audience — tablets with pre-Wave-2 icons — the G1-15 gate visits anyway; the sign-in screen is itself the honest answer).

4. **`?live=1` stays honoured.** It is in `docs/DEPLOY-SUPABASE.md` and the Turkish guide, it costs one line, and it still means something: it wins over `?tasarim=1`. *Rejected:* retiring it (it opens what it always opened; stripping it would only churn bookmarks).

5. **The design gallery stays, out of the precache.** `?tasarim=1` is G1-05's review page: no API, no data, linked from nowhere, and still the place the design is reviewed. It leaves the service worker's precache (8.6 kB): a ward PC's first visit downloads the live system and nothing else. *Rejected:* deleting it (it is not a legacy mode); keeping it precached (a roadmap item since Wave 1B).

6. **The first chunk is not split.** Measured at 146.74 kB / 48.02 kB gzip: React, ReactDOM, the scheduler, `main.jsx` and `LoadFailed.jsx`. The roadmap's threshold for splitting was about 250 kB gzip. The 500 kB warning was `legacyRoots`', and it goes with it. What protects the first chunk from now on is a test, not a split: `routing.test.js` pins `main.jsx`'s static imports to exactly `@fontsource-variable/figtree`, `./index.css`, `react`, `react-dom/client` and `./LoadFailed.jsx`, and its lazy imports to exactly the live UI and the gallery. *Rejected:* `manualChunks` for ReactDOM (React must load before anything renders, so a split only adds a request on a ward PC); a size assertion in a test (sizes are the build's, and the gate reads them).

7. **`permissions.js` goes. The two kept tests read the live catalogue mirror and the server's own file.** `routes.test.js` takes `PERMISSION_KEYS` from `live/screens/admin/catalogue.js`: the same 21 keys in the same order, held to `permissions.py` by `catalogue.test.js`. `liveAuth.test.js` needs three default groups' **rights** (pharmacist, biomedical, nurse) and reads them from `auth/permissions.py` as text. A derived tuple (`hospital_admin`, `unit_physician`) fails that reader loudly rather than reading as empty. *Rejected:* a trimmed `permissions.js` as a test-only mirror (a production-named module with no production importer is what Decision 2 forbids); literal rights in the test (they would drift from the server silently).

8. **The four API modules and `LoadFailed.jsx` stay where they are.** *Rejected:* moving the four under `src/live/` (about 20 importers and 6 tests churn with no behaviour change; `boundaries.test.js` already names them as the boundary; it would widen the main checkout's coming conflict). `LoadFailed.jsx` must stay outside `src/live/` in any case: it is in the first chunk.

9. **API methods and adapter exports that only the old workspace called stay.** `alarmQuality`, `verifyAudit`, `severityForm`, `signSeverityForm` and `setProfile` are the client half of Group 2–4 screens and are tested. `bedsFromPatients`, `ageFromBirthDate` and `awaitingLocalAdmission` are Group 2 acceptance criteria that the roadmap moved into `liveAdapters.test.js` deliberately. *Rejected:* trimming them (that would delete tests the roadmap kept on purpose, in a task about deleting modes).

10. **`ack.atSec` goes; `ack` stays.** The live board store tests `!a.ack` to decide whether an alarm still waits for an answer (`needsAnswer`, a safety predicate). `atSec` was the same instant in **seconds**, kept, the code says, "until G1-16 deletes" the workspace that computed time-to-acknowledge with it. Its own comment warns that `elapsed(ack.atSec)` would show an age of about 56 years without an error. *Rejected:* dropping `ack` (that rewrites a safety predicate inside a cleanup); keeping `atSec` (a unit trap waiting for the first screen to read it, and a comment that would now be false).

11. **The old app's Tailwind palette and dark switch go; the page's sans and `index.css` stay.** `brand`, `sev` and `darkMode: "class"` were used only by deleted files. Left in place, a `bg-sev-critical` written into a live component would compile to a colour no theme controls, and `tailwind.test.js` was pinning a palette nothing used. `font-sans` (Figtree) and `index.css`'s `<body>` colours are what `LoadFailed` is drawn in when the live UI's stylesheet could not load. *Rejected:* leaving the config alone (a dead palette behind a test that says "keep it exactly as it was"); removing `index.css` (`LoadFailed` would be unstyled exactly when it is shown).

12. **Server: nothing is removed; two comments are corrected** (see the table above). *Rejected:* removing `/notifications` (the mobile app reads it); removing `record_demo.py` now (a Python change for a script that harms nothing; the user decides, **Needs the user, 7**).

13. **No package change** (see "Not in this plan").

14. **Comments.** A comment that records where code came from ("ported from `liveStore.js`'s live half") stays: it is true history, and `e4cdf15` is where to read the original. A comment that becomes **false** is rewritten in the task that makes it false: one that says "until G1-16", "G1-16 deletes", that a removed file "is" something, or that the old app "may run in the same tab". *Rejected:* rewriting every provenance comment (churn in 20 live files for no reader's benefit).

15. **`docs/DEMO-DEPLOY.md` becomes a short note, not a deleted file.** Someone who remembers the demo finds what happened, which commit holds it, and what is left for the user. `docs/DEPLOY-SUPABASE.md` stays, corrected, because the deployment it describes exists until the user takes it down.

**The port (Tasks 4–5).** The user decided the sound and the notification come across before the deletion. These are the choices made in carrying them, each checked against the old code first.

16. **It lands before the deletion, as one task, because the net demands it.** A rule and an engine that no page mounts fail `reachable.test.js` (measured), so the rule, the engine, the provider and its mounting are one commit. The Settings tab is the next. *Rejected:* porting after the deletion (the old code would be gone; it is the reference); a rule-and-engine commit on its own (red by the project's own rule).

17. **One mapping, from the board store's own waiting queue.** `signals.js` reads `waitingAlarms`, so "nobody has answered it" is `needsAnswer`, floor included, and nothing re-derives it. It maps severity to the three patterns (critical, high, moderate; low and info silent) as the old `tier` did. **One departure:** a severity this build does not know, or none, sounds as critical. `SEVERITY_ORDER` reads it as possibly the worst, the bell counts it first, and a ward PC silent for a possibly-critical alarm is the worse failure; the old build was silent there, and the engine sends no such severity today. Another consequence is not a departure: a downgraded critical or high still sounds (the floor), as it did in the old build, which never looked at `downgraded`. *Rejected:* a second copy of "unanswered" in the sound code (amendments, (e)); keeping the old silence for an unknown severity.

18. **A board whose stream has dropped still sounds; one that cannot say what is open does not.** The old store kept its alarms on `stream-lost` and went on sounding them; it emptied them only when a load failed or the session ended. Kept, and said in the rule's comment and test. Nothing here ever claims that nothing is waiting: the only outputs are a sound and a notification, never a silence presented as an answer. *Rejected:* LIVE only (a stream that drops in the night would silence a ward whose alarms are still open: the most dangerous moment to go quiet).

19. **The opt-in is kept per browser, and a wanted sound that the browser has not started says so.** The old one was off after every page load. Kept that way, any reload (F5, a browser or a PC restarted overnight, a tab the browser discarded) would turn off a ward PC's alarm without a word. A deploy does not reload the page by itself, checked: the built `registerSW.js` only registers the worker. So the choice is stored (`hmc.alarmSound`), like the theme. The first click or key press anywhere starts the audio: the sign-in, the unlock, the button. Until then a button on every screen, the lock screen included, says the sound is waiting. *Rejected:* per page load (the silent switch-off above); stored with no waiting state (a page claiming a sound the browser has not let it make); per user (a ward PC is the alarm station, and the next person signing in should not inherit the last one's silence).

20. **It sounds through the lock and stops at the session's end.** The old build had no lock screen. A locked ward PC must still alert, so the provider sits outside the phases and is active while `seesBoard(phase, user)`: ready or LOCKED, with `board.view`. That is now one function that `Phases` uses too, so the board and the sound cannot disagree. The end of the session (sign-out, another account, the server ending it) stops the sound and closes every notification the page raised; the old page kept its notified set for its whole life. *Rejected:* silencing at the lock (a locked PC that does not alert); a sound that outlives the session (an alarm for a ward nobody is signed in to watch).

21. **A notification names its bed as the old one did, except while locked.** The body is the alarm's bed label, which the adapter falls back to the patient id (**Needs the user, 2**). While locked the screen promises numbers only, so one notification names no bed and the bed-naming ones are closed at the lock. Notifications are closed when a LIVE board says their alarm no longer waits; the old ones stayed until dismissed. The old `tag` (the alarm id, which carries the patient id) is dropped: the page de-duplicates by id itself. *Rejected:* names on a locked PC; dropping the bed everywhere (a change to what the ward reads today, the user's to make).

22. **The opt-in is in Settings; the permission banner is not ported.** The old top bar's sound and notification buttons become a Settings tab that says each state. The banner promised notifications "even when the tab is closed", and no build can keep that promise: there is no push service. *Rejected:* the top-bar buttons (the shell's top bar is designed, and a new control there is a design decision: **Needs the user, 4**); porting the banner's text.

23. **As built, after the review of Tasks 1–5 (`cf1aa7c`, 13.10).** *Fixed:* the engine keeps the pattern it was asked for apart from its timer, so a suspend and a resume that the page sees as one React batch (an audio device changed, Safari's "interrupted") sound it again instead of leaving a critical alarm silent under a "ready" pill; each play goes through a gain node of its own, cut on stop, so an acknowledgement or a sign-out silences the pulses already scheduled (up to ~2.8 s) too; the sound and the notification act on any board that holds a ward it **loaded** (`boardStore.js` `loaded`, `alarmsToSignal`) — Decision 18's LIVE and DEGRADED plus CONNECTING once the first load has landed, because the old build sounded its first load (a board that never loaded stays silent; the bell still waits for LIVE); a notification carries a `tag` again, one per alarm (`homunculus-alarm:<id>`) and one naming nothing while locked (`homunculus-alarm:locked`) — Decision 21 dropped the old tag, but without it two tabs stack their notifications; every notification is closed on `pagehide`; the permission is read again on `visibilitychange`; a plain-HTTP page reads "insecure" before "unsupported"; the waiting button is announced (`Announce`), hands focus to the page when it goes, and hides while a dialog holds the page inert. *Withdrawn:* the claim that the pattern is IEC 60601-1-8's. It is the old build's, kept for parity with its numbers unchanged (a critical burst lasts ~2.8 s and repeats every 2.5 s, so two overlap); a clinician or biomedical engineer reviews it against the standard in Group 2 (deferred.md). *Declared differences from the old build, kept:* (a) an alarm whose severity this build does not know also raises the critical **notification**, not only the critical sound (Decision 17's consequence); (b) a downgraded (chronic-expected) **moderate** alarm is silent — the floor keeps only critical and high waiting, and the engine cannot send a downgraded moderate today (it downgrades only to low); (c) a notification is raised **again** for an alarm still waiting after an unlock (the locked one stood in for it), after the alarm waits again having been answered or cleared, and in each new session — the old page notified each alarm id once for its whole life.

---

## Ground rules for every task

- **Your own worktree.** Work in `/c/tmp/g116-impl` on branch `feat/g1-16`, made from `feat/canli-tasarim` in Task 0. **Never touch `/c/Users/User/Desktop/Project/Homunculus AI`**: it is the user's main checkout, on another branch, holding uncommitted work that is not yours. `/c/tmp/homunculus-g1` is the reference worktree on `feat/canli-tasarim`: read it, do not commit in it. Never `git push`, deploy or run anything against the hospital VM. The plan author's scratch replays (`/c/tmp/g116plan/wt` … `wt5`) were removed once measured; `/c/tmp/g116plan/g116-replay.patch` (the first replay's diff) and the replay scripts under `/c/tmp/g116plan/` remain for reference. If you make a scratch worktree with a `node_modules` junction, unlink the junction before removing the worktree (PowerShell: `cmd /c rmdir "C:\tmp\…\dashboard\node_modules"`, then `git worktree remove --force`). A recursive delete that follows the junction would empty the shared `node_modules`.
- **Edit with the Write and Edit tools only, never `sed`, `python`, `node` or a shell heredoc.** A fresh worktree is **CRLF** (`core.autocrlf=true`), the Markdown documents included, and every block in this document is LF. Measured: a script matching this document's multi-line blocks against a fresh checkout matched none of them. A shell replacement either fails to match or rewrites a whole file's line endings. Heredocs drop backslashes: a heredoc ate a regex while this plan was being written. Use **Write** only for a file this plan gives in full (new or replaced whole); use **Edit** for every `replace … with …` pair, and the old text must match exactly once. Delete with `git rm <paths>`.
- **Stage explicit paths only:** `git rm <paths>` and `git add <paths>`, never `git add -A` or `git add .`. Before every commit run `git status --short` and `git diff --cached --stat`. If a staged path is not one the task lists, stop and ask instead of committing.
- **Commit after each task.** Every message ends with:

  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```
  That is the trailer current on 2026-10-13. The trailer follows the session that executes, not the plan: `amendments.md` records it changing three times. Use the attribution line your session is given.
- **Foreground gates.** Run every suite and build in the foreground, with the Bash timeout as the backstop. Never background a gate and wait on it: an agent that did sat silent for hours.
- **The suite and the build are two separate commands, never one chained line.** `LiveApp.test.jsx > "lands an account straight in the product, on its home — no setup wizard"` failed twice in Wave 3B with a build queued behind it in the same command, and passed every time alone. If you see it fail, re-run before investigating.

  ```bash
  cd /c/tmp/g116-impl/dashboard
  npx vitest run 2>&1 | tail -5
  ```
  ```bash
  cd /c/tmp/g116-impl/dashboard
  npx vite build 2>&1 | grep -E "\.js |built in|precache|larger than"
  ```
- **Filter tests by file, or by folder with a trailing slash** (`npx vitest run src/live/`). Vitest filters by substring, so `src/live` alone also runs `src/liveAuth.test.js` and the other top-level `live*` files.
- **Python:** only Task 9 touches a `.py` file (two comments). Its gate is that file's own run plus `py_compile`, on `/c/tmp/f7-py312/venv/Scripts/python.exe` (3.12.13, the image's version). **Never run `tests/test_infinity_vm_pilot.py`**, alone or in a full run: under contention it hangs (seven hours once). The whole Python suite is not in this plan's gate, because no Python behaviour changes.
- **D1 holds, and now it is permanent.** Nothing under `src/live/` imports anything outside it but the four API modules (`boundaries.test.js`). Nothing under `src/` exists that the page cannot reach (`reachable.test.js`). And `main.jsx` imports statically only what `routing.test.js` lists.
- **No comment under `src/` may contain `import (` or a quoted `import "x"`.** The shared reader takes either for an import, and the new net then fails on a comment (it happened, Task 1).
- **A test that puts the signal fakes on the page (`onPage`, `signals/fakeAudio.testutil.js`) takes them off again** (`undo()` in `afterEach` or a `finally`). They patch `window.AudioContext`, `window.Notification`, `window.isSecureContext` and `document.hidden`, and a leftover would make every later test's page a different browser.
- **No patient data, ever** (CLAUDE.md hard rule 6). No task here adds a fixture. The deleted `public/demo/*.json` were synthetic, recorded from the engine's own scenarios.
- **Counts:** every "Expected" figure is a delta from Task 0's base with the absolute value on `69f059f` in brackets. If Task 0 prints a different base, compare against it plus the delta. The per-file numbers are the ones that matter.

---

## File map

**Create:** `dashboard/src/reachable.test.js` (Task 1). The port (Task 4): `dashboard/src/live/signals/{signals.js,signals.test.js,alarmSound.js,alarmSound.test.js,AlarmSignals.jsx,AlarmSignals.test.jsx,fakeAudio.testutil.js}` and `dashboard/src/live/i18n/strings/signals.js` (extended in Task 5).

**Delete (80 files):** Task 1, 24 files (13 modules, 11 tests). Task 2, 25 files (11 modules, 9 tests, 5 JSON). Task 6, 31 files (14 modules, 17 tests; `clinicalAudio.js` among them, after Task 4 has ported it). The lists are in each task.

**Modify (29 files):**

| File | Change | Task |
|---|---|---|
| `dashboard/src/legacyRoots.jsx` | Comment reworded (1); replay and board branches gone (2); deleted (6) | 1, 2, 6 |
| `dashboard/src/legacyRoots.test.jsx` | Replay and board tests and mocks gone (2); deleted (6) | 2, 6 |
| `dashboard/src/main.jsx` | `withoutRetired`; replay and board out (2); rewritten whole: live and gallery only (6) | 2, 6 |
| `dashboard/src/routing.test.js` | URL fallbacks (2); rewritten whole (6) | 2, 6 |
| `dashboard/src/live/shell/routes.test.js` | `PERMISSION_KEYS` from the live catalogue | 3 |
| `dashboard/src/liveAuth.test.js` | Default groups' rights read from `permissions.py` | 3 |
| `dashboard/src/live/i18n/catalog.js` | The `signals` namespace | 4 |
| `dashboard/src/live/session/sessionStore.js` | `seesBoard(phase, user)`: one rule for "this session may see the board" | 4 |
| `dashboard/src/live/LiveApp.jsx` | `Phases` uses `seesBoard`; `<AlarmSignals>` around the phases; header | 4 |
| `dashboard/src/live/session/mount.testutil.jsx` | `<AlarmSignals>` in the providers every `mount()` gets | 4 |
| `dashboard/src/live/LiveApp.test.jsx` | The sound goes on through the lock, on the whole page (+1) | 4 |
| `dashboard/src/live/screens/settings/SettingsScreen.jsx` + `.test.jsx` | The "sound and notifications" tab (+4) | 5 |
| `dashboard/src/LoadFailed.jsx`, `live/apiErrors.test.js`, `live/boundaries.test.js`, `live/i18n/I18nProvider.test.jsx`, `live/i18n/strings.test.js`, `live/screens/admin/catalogue.js`, `live/screens/common/feedHealth.js`, `live/theme/ThemeProvider.jsx`, `live/theme/ThemeProvider.test.jsx` | Comments that became false | 6 |
| `dashboard/src/liveAdapters.js`, `liveAdapters.test.js` | `ack.atSec` and its helper gone; comments | 7 |
| `dashboard/src/devProxy.test.js` | Precache assertion; `index.html` assertion (+1) | 8 |
| `dashboard/src/live/theme/tailwind.test.js` | The old palette's assertion inverted; comments | 8 |
| `dashboard/tailwind.config.js` | `darkMode`, `brand`, `sev` gone | 8 |
| `dashboard/vite.config.js` | `globIgnores`, two comments | 8 |
| `dashboard/index.html` | `lang="az"`, no `class="dark"`, title | 8 |
| `homunculus-engine/tests/test_nginx_routes.py`, `homunculus-engine/src/homunculus/admin/service.py` | Comments naming `clinicalI18n.js` | 9 |

**Docs (Task 9):** the roadmap, `docs/homunculus-rehber-TR.md`, `docs/DEMO-DEPLOY.md`, `docs/DEPLOY-SUPABASE.md`, `docs/EDGE-BRIDGE-LOCAL.md`, `docs/superpowers/specs/2026-09-23-ldap-rbac-design.md`, and `/c/tmp/homunculus-plans/{amendments,deferred}.md` (outside the repo; not committed).

---

### Task 0: Baseline

**Files:** none changed except this plan, committed into the repo.

- [ ] **Step 1: Make your worktree**

```bash
git -C /c/tmp/homunculus-g1 worktree add /c/tmp/g116-impl -b feat/g1-16 feat/canli-tasarim
cd /c/tmp/g116-impl/dashboard
cmd //c "mklink /J node_modules C:\tmp\homunculus-g1\dashboard\node_modules"
git -C /c/tmp/g116-impl log --oneline -1
```
Expected: `Junction created for node_modules`, and the branch's tip. That was `69f059f docs: scope joins the closed lost updates; …` when this plan was measured, and `126a011 fix(dashboard): a refused stale write says what is known …` when it was finished. If it is a later commit, every count below is relative to what Step 2 prints. Never run `npm install`: the junction is the installed tree.

- [ ] **Step 2: Record the base**

```bash
cd /c/tmp/g116-impl/dashboard
npx vitest run 2>&1 | tail -5
```
Expected: `Test Files  108 passed (108)`, `Tests  2430 passed (2430)` (the same at `69f059f` and `126a011`).

```bash
cd /c/tmp/g116-impl/dashboard
npx vite build 2>&1 | grep -E "\.js |built in|precache|larger than"
```
Expected, as measured on `69f059f`: `DesignGallery-…js 8.61 kB`, `browser-…js 37.99 kB`, `index-…js 147.28 kB │ gzip: 48.18 kB`, `LiveApp-…js 160.83 kB`, `Toast-…js 178.25 kB` (178.53 from `126a011` on), `legacyRoots-…js 529.36 kB │ gzip: 165.88 kB`, `(!) Some chunks are larger than 500 kB`, `✓ built in …`, `precache  22 entries (78….… KiB)`.

- [ ] **Step 3: Record the files this plan edits**

```bash
cd /c/tmp/g116-impl/dashboard
npx vitest run src/routing.test.js src/legacyRoots.test.jsx src/liveAuth.test.js src/live/shell/routes.test.js src/liveAdapters.test.js src/devProxy.test.js src/live/theme/tailwind.test.js src/live/boundaries.test.js src/live/apiErrors.test.js 2>&1 | grep -E "Test Files|Tests "
npx vitest run src/live/ 2>&1 | grep -E "Test Files|Tests "
```
Expected: `Test Files  9 passed (9)`, `Tests  266 passed (266)`. That is routing 17, legacyRoots 4, liveAuth 16, routes 22, liveAdapters 50, devProxy 4, tailwind 12, boundaries 4 and apiErrors 137. Then `Test Files  62 passed (62)`, `Tests  1504 passed (1504)`: `src/live/` alone, which only the port (Tasks 4–5) changes in number: to 65 / 1540.

- [ ] **Step 4: Commit the plan**

```bash
cd /c/tmp/g116-impl
cp /c/tmp/homunculus-plans/2026-10-13-g1-16-eski-modlari-kaldir.md docs/superpowers/plans/
git add docs/superpowers/plans/2026-10-13-g1-16-eski-modlari-kaldir.md
git commit -m "$(cat <<'EOF'
docs(plan): G1-16 — the demo and every legacy mode leave the dashboard

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

**Gate:** 108 files / 2430 tests, the build as above with its one warning, 22 precache entries.

---

### Task 1: The reachability net, and the 13 modules nothing reaches

**Files:**
- Create: `dashboard/src/reachable.test.js`
- Modify: `dashboard/src/legacyRoots.jsx` (one comment line)
- Delete (`git rm`): `dashboard/src/{InfinityBeds.jsx,InfinityBeds.test.jsx,admissionPage.jsx,alarmDensity.js,alarmDensity.test.js,clinicalAdmin.jsx,alarmQualityPanel.test.jsx,auditIntegrity.test.jsx,clinicalUi.jsx,feedHealth.js,feedHealth.test.js,loginHero.jsx,patientLabel.js,patientLabel.test.js,patientScope.js,patientScope.test.js,risk.js,risk.test.js,rrtQueue.js,rrtQueue.test.js,policySettings.test.jsx,severityScore.jsx,severityScore.test.jsx,wallBoard.jsx}`

- [ ] **Step 1: Write the net.** Create `dashboard/src/reachable.test.js` with exactly:

```js
// Every module under src/ is one the page can reach, and nothing is kept that it cannot.
//
// This project's own name for its worst recurring failure is "written, tested, never connected"
// (patientScope.js says it of itself: an assignment matrix that existed for years and changed no
// screen). Thirteen modules were in exactly that state when G1-16 began — each with a green test
// file, none reachable from the page — and the demo's removal would have added two dozen more had
// it deleted only the files it named. A module the page cannot import is not part of the product,
// however green its tests: it is either wired in, or it is deleted (git keeps it).
//
// The walk starts where the browser does — index.html loads main.jsx and nothing else — and
// follows every import the shared reader can see (live/imports.testutil.js, the one boundaries.test.js
// and routing.test.js use): static, re-exported, side-effect-only and `import("…")`. Anything it
// cannot follow fails here, as there: an import this test cannot see is a module it cannot vouch for.
// Tests and test utilities are not the product and are not walked or required.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { importsOf } from "./live/imports.testutil.js";

const SRC = path.dirname(fileURLToPath(import.meta.url));
const ENTRY = path.join(SRC, "main.jsx");
const rel = (file) => path.relative(SRC, file).split(path.sep).join("/");
const isProduct = (name) => /\.(js|jsx)$/.test(name) && !/\.test\.|\.testutil\./.test(name) && name !== "setupTests.js";

function sources(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return isProduct(entry.name) ? [full] : [];
  });
}

/** Every product module the page reaches from `entry`, and what the walk could not follow. */
function walk(entry) {
  const reached = new Set();
  const problems = [];
  const stack = [entry];
  while (stack.length) {
    const file = stack.pop();
    if (reached.has(file)) continue;
    reached.add(file);
    const { specs, unreadable } = importsOf(fs.readFileSync(file, "utf8"));
    for (const what of unreadable) problems.push(`${rel(file)} -> ${what} (cannot be followed)`);
    for (const spec of specs) {
      if (!spec.startsWith(".")) continue;                       // a package
      const target = path.resolve(path.dirname(file), spec);
      if (!/\.(js|jsx)$/.test(target)) continue;                 // a stylesheet, an asset
      if (!fs.existsSync(target)) problems.push(`${rel(file)} -> ${spec} (no such file)`);
      else stack.push(target);
    }
  }
  return { reached, problems };
}

describe("the page reaches every module under src/", () => {
  const { reached, problems } = walk(ENTRY);

  it("can follow every import from main.jsx", () => {
    expect(problems).toEqual([]);
  });

  it("finds the page's own modules", () => {
    expect(reached.size).toBeGreaterThan(80);
    expect([...reached].map(rel)).toEqual(expect.arrayContaining(["main.jsx", "live/LiveApp.jsx", "backendApi.js"]));
  });

  it("keeps no module the page cannot reach", () => {
    expect(sources(SRC).filter((file) => !reached.has(file)).map(rel).sort()).toEqual([]);
  });
});
```

- [ ] **Step 2: Watch it fail, for two reasons**

```bash
cd /c/tmp/g116-impl/dashboard
npx vitest run src/reachable.test.js 2>&1 | grep -E "Tests |\+   \""
```
Expected: `Tests  2 failed | 1 passed (3)`, and the received arrays:
- `"legacyRoots.jsx -> import ( (cannot be followed)"`. This is a comment, not an import: `legacyRoots.jsx` line 5 says "behind one lazy import (main.jsx)".
- `"InfinityBeds.jsx"`, `"admissionPage.jsx"`, `"alarmDensity.js"`, `"clinicalAdmin.jsx"`, `"clinicalUi.jsx"`, `"feedHealth.js"`, `"loginHero.jsx"`, `"patientLabel.js"`, `"patientScope.js"`, `"risk.js"`, `"rrtQueue.js"`, `"severityScore.jsx"`, `"wallBoard.jsx"`. These are the 13 modules nothing reaches.

If the list differs, stop. A module added since `126a011` that the page cannot reach needs a decision, not a deletion by this task.

- [ ] **Step 3: Reword the comment the reader mistakes for an import.** Edit `dashboard/src/legacyRoots.jsx`. Replace:

```js
// They sit behind one lazy import (main.jsx) so that the live page does not download them. The
```
with:
```js
// They sit behind main.jsx's one lazy import, so that the live page does not download them. The
```
```bash
cd /c/tmp/g116-impl/dashboard
npx vitest run src/reachable.test.js 2>&1 | grep -E "Tests "
```
Expected: `Tests  1 failed | 2 passed (3)`. Only "keeps no module the page cannot reach" is left: the first failure was this line alone.

- [ ] **Step 4: Delete the 13 modules and their 11 test files.** Each is in the table "Reachable from nothing today" above, with where its job went.

```bash
cd /c/tmp/g116-impl/dashboard
git rm -q src/InfinityBeds.jsx src/InfinityBeds.test.jsx src/admissionPage.jsx src/alarmDensity.js src/alarmDensity.test.js src/clinicalAdmin.jsx src/alarmQualityPanel.test.jsx src/auditIntegrity.test.jsx src/clinicalUi.jsx src/feedHealth.js src/feedHealth.test.js src/loginHero.jsx src/patientLabel.js src/patientLabel.test.js src/patientScope.js src/patientScope.test.js src/risk.js src/risk.test.js src/rrtQueue.js src/rrtQueue.test.js src/policySettings.test.jsx src/severityScore.jsx src/severityScore.test.jsx src/wallBoard.jsx
npx vitest run src/reachable.test.js 2>&1 | grep -E "Tests "
```
Expected: `Tests  3 passed (3)`.

- [ ] **Step 5: Gate**

```bash
cd /c/tmp/g116-impl/dashboard
npx vitest run 2>&1 | tail -5
```
Expected: `Test Files  98 passed (98)`, `Tests  2312 passed (2312)`: −10 files / −118 tests (−121 deleted, +3 new).

```bash
cd /c/tmp/g116-impl/dashboard
npx vite build 2>&1 | grep -E "\.js |built in|precache|larger than"
```
Expected: the chunk sizes of Task 0, unchanged (none of the 13 was in any chunk), the warning still there (`legacyRoots`), `precache  22 entries`.

- [ ] **Step 6: Commit**

```bash
cd /c/tmp/g116-impl
git add dashboard/src/reachable.test.js dashboard/src/legacyRoots.jsx
git status --short
git commit -m "$(cat <<'EOF'
test(dashboard): every module under src/ is reachable from the page; the 13 that were not are deleted

G1-16, Task 1. reachable.test.js walks the import graph from main.jsx with the shared reader and
fails on any production module it cannot reach. Thirteen were in that state — kept "for Groups
2-4", each with green tests, none connected: wallBoard, rrtQueue, alarmDensity, severityScore,
clinicalAdmin, InfinityBeds, admissionPage, patientLabel, patientScope, feedHealth, risk,
clinicalUi, loginHero. They are readable at e4cdf15; their targets are in the roadmap.

legacyRoots.jsx: a comment said "lazy import (main.jsx)", which the reader takes for import(.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```
`git status --short` before the commit must show exactly 24 `D` lines, one `A` (`reachable.test.js`) and one `M` (`legacyRoots.jsx`).

**Gate:** 98 / 2312 (−10 / −118); `reachable.test.js` 3; build unchanged with its one warning; 22 precache entries.

---

### Task 2: Replay and the legacy board: their addresses open the live system

**Files:**
- Modify: `dashboard/src/routing.test.js`, `dashboard/src/main.jsx`, `dashboard/src/legacyRoots.jsx` (replaced whole), `dashboard/src/legacyRoots.test.jsx`
- Delete (`git rm`): `dashboard/src/{Board.jsx,Board.test.jsx,demo.jsx,demo.test.jsx,demoTransport.js,demoTransport.test.js,api.js,i18n.js,i18n.test.jsx,theme.js,notifications.js,notifications.test.js,Toasts.jsx,Toasts.test.jsx,PatientDetail.jsx,PatientDetail.test.jsx,PatientList.jsx,PatientList.test.jsx,NotificationHistory.jsx,NotificationHistory.test.jsx}` and `dashboard/public/demo/{news2_deterioration,news2_partial_nce_only,septic_shock,stable_control,under_resuscitated}.json`

`withoutRetired` is born here with the board's and the replay's parameters. Task 6 adds the simulation's and the previous workspace's. `#/demo` and `?demo=1` / `?eski=1` still open their roots until Task 6.

- [ ] **Step 1: The tests first.** Edit `dashboard/src/routing.test.js`. Replace:

```js
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { render, screen } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { importsOf, staticImportsOf } from "./live/imports.testutil.js";
import { chooseMode, AppShell } from "./main.jsx";
```
with:
```js
import { describe, it, expect, vi, afterEach } from "vitest";
import { createElement } from "react";
import { render, screen } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { importsOf, staticImportsOf } from "./live/imports.testutil.js";
import { chooseMode, withoutRetired, AppShell } from "./main.jsx";

/** An address as `window.location` carries it: `{pathname, search, hash}`. */
const at = (url) => new URL(url, "http://localhost:3000");
```

Replace:
```js
  it("routes the replay demo via ?mode=replay", () => {
    expect(chooseMode(new URLSearchParams("mode=replay"))).toBe("replay");
  });

  it("routes the replay demo via ?scenario=", () => {
    expect(chooseMode(new URLSearchParams("scenario=septic_shock"))).toBe("replay");
  });

  it("routes the legacy board", () => {
    expect(chooseMode(new URLSearchParams("board=1"))).toBe("board");
  });
```
with:
```js
  // G1-16 removed the roots that were not the live system. Their addresses are still in
  // bookmarks and in links in old messages: each opens what the bare URL opens — never a blank
  // page, and never a simulation.
  it.each(["mode=replay", "scenario=septic_shock", "board=1", "board=1&token=abc"])(
    "opens the live system on the retired ?%s", (query) => {
      expect(chooseMode(new URLSearchParams(query))).toBe("live");
    },
  );
```

Replace the one line:
```js
describe("AppShell", () => {
```
with:
```js
describe("the address an old bookmark is left with", () => {
  // The page it opens is the live system, so the address must stop saying otherwise: a bar that
  // reads ?mode=replay above real patients is a claim, and ?board=1&token=… kept a tenant token in
  // the address, the history and every bookmark made from it.
  it("is not rewritten when it carries nothing retired", () => {
    for (const url of ["/", "/?live=1", "/?tasarim=1", "/#/alarms", "/?mode=kiosk", "/#/demographics"]) {
      expect(withoutRetired(at(url)), url).toBeNull();
    }
  });

  it("loses the legacy board's parameter, and the tenant token it carried", () => {
    expect(withoutRetired(at("/?board=1&token=abc"))).toBe("/");
    expect(withoutRetired(at("/?token=abc"))).toBe("/");
  });

  it("loses the replay's", () => {
    expect(withoutRetired(at("/?mode=replay&scenario=nec"))).toBe("/");
    expect(withoutRetired(at("/?scenario=nec"))).toBe("/");
  });

  it("keeps everything else, the path and the deep link included", () => {
    expect(withoutRetired(at("/panel/?board=1&live=1#/alarms"))).toBe("/panel/?live=1#/alarms");
  });
});

describe("the page as it loads", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState(null, "", "/");
  });

  // main.jsx does this once, at load, before anything renders: LiveApp keeps `location.search`
  // whenever it clears the hash, so a retired parameter left in the bar would stay there for the
  // whole session.
  it("rewrites an old bookmark's address before anything renders", async () => {
    window.history.replaceState(null, "", "/?board=1&token=abc#/alarms");
    vi.resetModules();
    await import("./main.jsx");
    expect(window.location.search).toBe("");
    expect(window.location.hash).toBe("#/alarms");
  });

  it("leaves an address with nothing retired untouched — a reload keeps its place", async () => {
    window.history.replaceState(null, "", "/?live=1#/patients/P-1");
    const replace = vi.spyOn(window.history, "replaceState");
    vi.resetModules();
    await import("./main.jsx");
    expect(replace).not.toHaveBeenCalled();
    expect(window.location.hash).toBe("#/patients/P-1");
  });
});

describe("AppShell", () => {
```

- [ ] **Step 2: Watch them fail**

```bash
cd /c/tmp/g116-impl/dashboard
npx vitest run src/routing.test.js 2>&1 | grep -E "Tests "
```
Expected: `Tests  9 failed | 15 passed (24)`. The four `opens the live system on the retired ?…` fail with `expected 'replay'` or `'board' to be 'live'`; four with `withoutRetired is not a function`; and `rewrites an old bookmark's address…` with `expected '?board=1&token=abc' to be ''`. "leaves an address with nothing retired untouched" passes already, and must: it guards against a cleanup that rewrites too much.

- [ ] **Step 3: `main.jsx`.** Edit `dashboard/src/main.jsx`. Replace:

```js
const params = new URLSearchParams(window.location.search);

/**
 * Which mode a URL selects. Exported so the routing is testable without a DOM.
 *
 * The bare URL — no query string at all — is the live system: the address a clinician
 * naturally types must be the real one, not a simulation. `?demo=1` keeps the simulation
 * reachable for anyone who wants it deliberately. `?live=1` remains honoured for old links
 * and, being an explicit ask for the real system, wins over a simultaneous `?demo=1`: showing
 * simulated data by accident is the worse failure of the two.
 */
export function chooseMode(params) {
  if (params.get("live") === "1") return "live";
  if (params.get("demo") === "1") return "demo";
  if (params.get("mode") === "replay" || params.has("scenario")) return "replay";
  if (params.get("board") === "1") return "board";
  // The new UI's design review page (G1-05): no API, no patient data, linked from nowhere.
  if (params.get("tasarim") === "1") return "tasarim";
```
with:
```js
/**
 * Which mode a URL selects. Exported so the routing is testable without a DOM.
 *
 * The bare URL — no query string at all — is the live system: the address a clinician
 * naturally types must be the real one, not a simulation. `?demo=1` keeps the simulation
 * reachable for anyone who wants it deliberately. `?live=1` remains honoured for old links
 * and, being an explicit ask for the real system, wins over a simultaneous `?demo=1`: showing
 * simulated data by accident is the worse failure of the two. The replay (`?mode=replay`,
 * `?scenario=`) and the legacy board (`?board=1`) are gone (G1-16): their addresses open the
 * live system, and `withoutRetired` takes their parameters out of the address.
 */
export function chooseMode(params) {
  if (params.get("live") === "1") return "live";
  if (params.get("demo") === "1") return "demo";
  // The new UI's design review page (G1-05): no API, no patient data, linked from nowhere.
  if (params.get("tasarim") === "1") return "tasarim";
```

Replace:
```js
  if (params.get("eski") === "1") return "eski";
  return "live";
}

function pickRoot(mode) {
```
with:
```js
  if (params.get("eski") === "1") return "eski";
  return "live";
}

/** Parameters only a removed root read. `mode` is retired only as `mode=replay`: another value
 *  is not this page's to take away. */
const RETIRED_PARAMS = Object.freeze(["board", "token", "scenario"]);

/**
 * The address an old bookmark is left with once the parameters of the roots G1-16 removed are
 * taken out — or null when it carries none, and must not be touched. Exported for its tests.
 *
 * Such an address opens the live system (chooseMode), so it must stop saying otherwise: a bar
 * reading `?mode=replay` above real patients is a claim, and `?board=1&token=…` kept a tenant
 * token in the address, the history and every bookmark made from it. Everything else stays —
 * the path, any other parameter and the hash, which is a deep link the live UI uses once.
 */
export function withoutRetired({ pathname, search, hash }) {
  const query = new URLSearchParams(search);
  let changed = false;
  for (const key of RETIRED_PARAMS) {
    if (query.has(key)) {
      query.delete(key);
      changed = true;
    }
  }
  if (query.get("mode") === "replay") {
    query.delete("mode");
    changed = true;
  }
  if (!changed) return null;
  const rest = query.toString();
  return `${pathname}${rest ? `?${rest}` : ""}${hash}`;
}

// Once, before anything renders: LiveApp keeps `location.search` whenever it clears the hash, so a
// retired parameter left here would stay in the bar for the whole session.
const cleaned = withoutRetired(window.location);
if (cleaned !== null) window.history.replaceState(window.history.state, "", cleaned);
const params = new URLSearchParams(window.location.search);

function pickRoot(mode) {
```

Replace:
```js
  // Everything else — the previous live workspace (?eski=1), the simulation (?demo=1), the replay
  // demonstration and the legacy bearer-token board — is one lazy chunk of its own, so the live
  // page never downloads a simulation it does not render (legacyRoots.jsx).
  return <React.Suspense fallback={null}><LegacyRoot mode={mode} params={params} /></React.Suspense>;
```
with:
```js
  // Everything else — the previous live workspace (?eski=1) and the simulation (?demo=1) — is one
  // lazy chunk of its own, so the live page never downloads a simulation it does not render
  // (legacyRoots.jsx).
  return <React.Suspense fallback={null}><LegacyRoot mode={mode} /></React.Suspense>;
```

Replace:
```js
 * The banner belongs only to the simulation: demo and replay both draw from fabricated data, so
 * both say so. Live and board talk to the real API — labelling them as demonstration data would
 * be false, and a notice that is sometimes wrong is worse than none, because people stop reading it.
 */
export function AppShell({ mode, children }) {
  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden">
      {mode === "demo" || mode === "replay" ? (
```
with:
```js
 * The banner belongs only to the simulation, which draws from fabricated data and says so. Live
 * talks to the real API — labelling it as demonstration data would be false, and a notice that
 * is sometimes wrong is worse than none, because people stop reading it.
 */
export function AppShell({ mode, children }) {
  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden">
      {mode === "demo" ? (
```

- [ ] **Step 4: `legacyRoots.jsx` without the replay and the board.** Write `dashboard/src/legacyRoots.jsx` whole:

```jsx
// src/legacyRoots.jsx — every root that is NOT the live system: the previous live workspace
// (?eski=1, the reference Wave 3 ports from, removed with the demo in G1-16) and the simulation
// (?demo=1). The replay demonstration and the legacy bearer-token board are already gone.
//
// They sit behind main.jsx's one lazy import, so that the live page does not download them. The
// simulation, its data builder and the old workspace are the bulk of this bundle — 710 kB in the
// first chunk — and a ward PC opening the real system was fetching every byte of a simulation it
// never renders. Nothing here is new code: it is main.jsx's own branches, moved.
import React from "react";
import { ClinicalDemo } from "./ClinicalDemo.jsx";
import { createDemoStore, buildRealisticState } from "./clinicalDemo.js";
import { createLiveStore } from "./liveStore.js";
import { backendApi } from "./backendApi.js";

/** The previous live workspace: the real API under the old ClinicalDemo screens. */
function Eski() {
  const [store] = React.useState(() => createLiveStore({
    api: backendApi,
    base: createDemoStore(buildRealisticState()),
  }));
  // In an effect, not while rendering: reading the stored session is a request, and a render may
  // be thrown away or run twice. Fire-and-forget — a page refresh must reopen the stored session
  // instead of signing the clinician out, and a failure quietly leaves the login screen, which
  // renders meanwhile anyway.
  React.useEffect(() => { store.restoreSession(); }, [store]);
  // simulation stays false: this is the real ward. See the note on ClinicalDemo.
  return <ClinicalDemo store={store} />;
}

export default function LegacyRoot({ mode }) {
  if (mode === "eski") return <Eski />;
  return <ClinicalDemo simulation />;
}
```

- [ ] **Step 5: Its test.** Edit `dashboard/src/legacyRoots.test.jsx`. Replace:

```js
// it have their own tests (ClinicalDemo.rbac, Board, demo); what is pinned here is which one each
```
with:
```js
// it have their own tests (ClinicalDemo.rbac); what is pinned here is which one each
```
Replace:
```js
vi.mock("./Board.jsx", () => ({ Board: ({ token }) => <p>board token={token}</p> }));
vi.mock("./demo.jsx", () => ({ DemoApp: ({ scenario }) => <p>replay scenario={scenario}</p> }));
vi.mock("./ClinicalDemo.jsx"
```
with:
```js
vi.mock("./ClinicalDemo.jsx"
```
Replace:
```js
const params = (query) => new URLSearchParams(query);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the roots that are not the live system", () => {
  it("gives ?eski=1 the real API and never the simulation", () => {
    render(<LegacyRoot mode="eski" params={params("")} />);
```
with:
```js
beforeEach(() => {
  vi.clearAllMocks();
});

describe("the roots that are not the live system", () => {
  it("gives ?eski=1 the real API and never the simulation", () => {
    render(<LegacyRoot mode="eski" />);
```
Replace:
```js
    render(<LegacyRoot mode="demo" params={params("")} />);
    expect(screen.getByText("simulation")).toBeInTheDocument();
    expect(createLiveStore).not.toHaveBeenCalled();
  });

  it("takes the replay's scenario from the address, and has a default", () => {
    const { unmount } = render(<LegacyRoot mode="replay" params={params("scenario=nec")} />);
    expect(screen.getByText("replay scenario=nec")).toBeInTheDocument();
    unmount();
    render(<LegacyRoot mode="replay" params={params("")} />);
    expect(screen.getByText("replay scenario=septic_shock")).toBeInTheDocument();
  });

  it("falls back to the legacy board, with the token from the address", () => {
    const { unmount } = render(<LegacyRoot mode="board" params={params("token=abc")} />);
    expect(screen.getByText("board token=abc")).toBeInTheDocument();
    unmount();
    render(<LegacyRoot mode="board" params={params("")} />);
    expect(screen.getByText("board token=dev-token")).toBeInTheDocument();
  });
});
```
with:
```js
    render(<LegacyRoot mode="demo" />);
    expect(screen.getByText("simulation")).toBeInTheDocument();
    expect(createLiveStore).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Delete the board and replay cluster, and the replay scenarios.** I checked that nothing on the simulation's side imports any of these (`i18n.js`, `theme.js`, `api.js` and `notifications.js` have importers only inside this set).

```bash
cd /c/tmp/g116-impl/dashboard
git rm -q src/Board.jsx src/Board.test.jsx src/demo.jsx src/demo.test.jsx src/demoTransport.js src/demoTransport.test.js src/api.js src/i18n.js src/i18n.test.jsx src/theme.js src/notifications.js src/notifications.test.js src/Toasts.jsx src/Toasts.test.jsx src/PatientDetail.jsx src/PatientDetail.test.jsx src/PatientList.jsx src/PatientList.test.jsx src/NotificationHistory.jsx src/NotificationHistory.test.jsx public/demo/news2_deterioration.json public/demo/news2_partial_nce_only.json public/demo/septic_shock.json public/demo/stable_control.json public/demo/under_resuscitated.json
ls public
npx vitest run src/routing.test.js src/legacyRoots.test.jsx src/reachable.test.js 2>&1 | grep -E "Test Files|Tests "
```
Expected: `icon.svg` only; `Test Files  3 passed (3)`, `Tests  29 passed (29)` (routing 24, legacyRoots 2, reachable 3). If `reachable.test.js` names a module, something outside this list imported one of the deleted files. Stop and find it.

- [ ] **Step 7: Gate**

```bash
cd /c/tmp/g116-impl/dashboard
npx vitest run 2>&1 | tail -5
```
Expected: `Test Files  89 passed (89)`, `Tests  2279 passed (2279)`: −9 / −33 (−38 deleted; legacyRoots −2; routing +7).

```bash
cd /c/tmp/g116-impl/dashboard
npx vite build 2>&1 | grep -E "\.js |built in|precache|larger than"
ls dist
```
Expected: `index-…js 147.58 kB │ gzip: 48.32 kB` (+0.3 kB: `withoutRetired`), `legacyRoots-…js 511.81 kB │ gzip: 160.59 kB` (still over 500 kB, so the warning stays until Task 6), the other chunks as before, `precache  22 entries`. `ls dist` shows no `demo`.

- [ ] **Step 8: Commit**

```bash
cd /c/tmp/g116-impl
git add dashboard/src/routing.test.js dashboard/src/main.jsx dashboard/src/legacyRoots.jsx dashboard/src/legacyRoots.test.jsx
git status --short
git commit -m "$(cat <<'EOF'
feat(dashboard): the replay and the legacy board are gone; their addresses open the live system

G1-16, Task 2. ?mode=replay, ?scenario= and ?board=1 now open what the bare URL opens, and
main.jsx's withoutRetired takes board, token, scenario and mode=replay out of the address before
anything renders: a ?board=1&token=… bookmark kept a tenant credential in the bar and the
history. Deleted with them: Board, demo, demoTransport, api, i18n, theme, notifications, Toasts,
PatientDetail, PatientList, NotificationHistory, their nine test files and the five recorded
replay scenarios (public/demo).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```
`git status --short` must show exactly 25 `D` lines and 4 `M` lines.

**Gate:** 89 / 2279 (−9 / −33); routing 24, legacyRoots 2, reachable 3; `legacyRoots` 511.81 kB, warning still there; no `dist/demo`; 22 precache entries.

---

### Task 3: Two kept tests stop reading `permissions.js`

**Files:** Modify `dashboard/src/live/shell/routes.test.js` and `dashboard/src/liveAuth.test.js`.

Done before Task 6 so that the large deletion only deletes. No count changes.

- [ ] **Step 1: The route table's test reads the live catalogue.** Edit `dashboard/src/live/shell/routes.test.js`. Replace:

```js
import { PERMISSION_KEYS } from "../../permissions.js";
```
with:
```js
import { PERMISSION_KEYS } from "../screens/admin/catalogue.js";
```
The two lists are identical: 21 keys, same order. `catalogue.test.js` holds the live one to `permissions.py`.

- [ ] **Step 2: The session test reads the groups' rights from the server's file.** Edit `dashboard/src/liveAuth.test.js`. Replace:

```js
import { describe, it, expect } from "vitest";
import {
  decodeJwtPayload, sessionFromToken, accessProblem, secretFromProvisioningUri,
  NO_PERMISSIONS, NO_BOARD_ACCESS,
} from "./liveAuth.js";
import { DEFAULT_GROUPS } from "./permissions.js";
```
with:
```js
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  decodeJwtPayload, sessionFromToken, accessProblem, secretFromProvisioningUri,
  NO_PERMISSIONS, NO_BOARD_ACCESS,
} from "./liveAuth.js";

// A default group's rights, read from the backend's own catalogue (auth/permissions.py) as text:
// the rights a token carries are the server's, and the dashboard keeps no copy of them to drift.
// Only groups written as a literal tuple — `"permissions": ("board.view", …)` — can be read; a
// derived one (hospital_admin, unit_physician) fails here, loudly, rather than reading as empty.
const PERMISSIONS_PY = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)),
  "../../homunculus-engine/src/homunculus/auth/permissions.py"), "utf8");
function backendPermsOf(slug) {
  const spec = new RegExp(`\\{"slug": "${slug}"[^}]*?"permissions": \\(([^)]*)\\)`).exec(PERMISSIONS_PY);
  if (!spec) throw new Error(`auth/permissions.py: no literal permissions tuple for "${slug}"`);
  return [...spec[1].matchAll(/"([\w.]+)"/g)].map((m) => m[1]);
}
```
Replace:
```js
  const permsOf = (slug) => [...DEFAULT_GROUPS.find((g) => g.slug === slug).permissions];
```
with:
```js
  const permsOf = backendPermsOf;
```
`\{"slug": "nurse"` cannot match `charge_nurse`: the character before `nurse` there is `_`, not `"`. `("devices.manage",)`, biomedical's one-element tuple, reads as `["devices.manage"]`. The test asserts exactly that.

- [ ] **Step 3: Run them**

```bash
cd /c/tmp/g116-impl/dashboard
npx vitest run src/liveAuth.test.js src/live/shell/routes.test.js 2>&1 | grep -E "Test Files|Tests "
grep -rn 'permissions\.js"' src --include=*.js --include=*.jsx | grep -v "^src/\(ClinicalDemo\|clinicalDemo\|liveStore\|liveAdmin\|permissions\|nav\|i18n\.rbac\|admin/\)"
```
Expected: `Test Files  2 passed (2)`, `Tests  38 passed (38)` (16 + 22), and the `grep` prints nothing: everything still importing `permissions.js` is deleted in Task 6.

- [ ] **Step 4: Gate**

```bash
cd /c/tmp/g116-impl/dashboard
npx vitest run 2>&1 | tail -5
```
Expected: `Test Files  89 passed (89)`, `Tests  2279 passed (2279)`, unchanged.

```bash
cd /c/tmp/g116-impl/dashboard
npx vite build 2>&1 | grep -E "built in|precache|larger than"
```
Expected: as Task 2 (measured: the same chunk hashes, since only test files changed), the warning still there, `precache  22 entries`.

- [ ] **Step 5: Commit**

```bash
cd /c/tmp/g116-impl
git add dashboard/src/live/shell/routes.test.js dashboard/src/liveAuth.test.js
git status --short
git commit -m "$(cat <<'EOF'
test(dashboard): the route table and the session tests stop reading the old permissions.js

G1-16, Task 3. routes.test.js takes PERMISSION_KEYS from the live catalogue (the same 21 keys,
held to auth/permissions.py by catalogue.test.js); liveAuth.test.js reads the three default
groups' rights it needs from auth/permissions.py itself, so no dashboard copy can drift.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

**Gate:** 89 / 2279 unchanged; liveAuth 16, routes 22.

---

### Task 4: The alarm sound and the critical-alarm notification, ported — and kept through the lock

**Files:**
- Create: `dashboard/src/live/signals/fakeAudio.testutil.js`, `signals.js` + `signals.test.js`, `alarmSound.js` + `alarmSound.test.js`, `AlarmSignals.jsx` + `AlarmSignals.test.jsx`; `dashboard/src/live/i18n/strings/signals.js`
- Modify: `dashboard/src/live/i18n/catalog.js`, `dashboard/src/live/session/sessionStore.js`, `dashboard/src/live/LiveApp.jsx`, `dashboard/src/live/session/mount.testutil.jsx`, `dashboard/src/live/LiveApp.test.jsx`

**The user decided (13.10):** the opt-in alarm sound and the background critical-alarm notification come into the new UI before G1-16 deletes their last copy (Task 6 deletes `clinicalAudio.js` and `ClinicalDemo.jsx`). **This task and Task 5 are that port.** They must land, and pass, before Task 6.

**What the old build does — read from the code, not remembered.** `ClinicalDemo.jsx` 4242–4320 and 857–925 (the top bar), `clinicalAudio.js`, and `liveAdapters.js` / `liveStore.js` at `e4cdf15`. The VM's build (`538ba54`) is identical in all of it: checked with `diff --strip-trailing-cr`, which differs only in line endings.
- **The sound** is opt-in: a top-bar button, `useState(false)`, never saved, so **off after every page load**. Turning it on is the click that starts the browser's audio (`enableAudio`). It plays the **worst tier among the alarms nobody has acknowledged** (`status === "FIRED"`, and not `mutedUntil`, which the live system never sets). The tier comes from the engine's severity: critical → CRITICAL, high → HIGH, moderate → MEDIUM. Low, info, an unknown severity and none have no tier and are **silent**; so is a downgraded (chronic-expected) alarm, because the engine lowers it to LOW.
- **The patterns** follow IEC 60601-1-8, square-wave pulses. CRITICAL: 960 Hz, 10 pulses (five, a 350 ms gap, five), every 2.5 s. HIGH: 640 Hz, 3 pulses every 12 s. MEDIUM: 500 Hz, 3 pulses every 20 s. They repeat until the worst tier changes or none is left. Acknowledging the alarm silences it.
- **When the stream drops**, the old store **keeps** its alarms (`stream-lost` touches only `connection`) and the sound goes on. A failed load empties them, and the sound stops. **Sign-out** empties them too (`endSession`), so the sound stops; but the "on" flag survives for the next session on that page.
- **The notification** uses the browser's `Notification` API directly: no service worker, no push. Permission is asked from a top-bar button, and from a dismissable banner that claimed alarms would arrive "even when the tab is closed". That is not true; nothing can raise one from a closed tab. A plain-HTTP page is detected and the screen says it. A notification is raised from an effect on every render **while `document.hidden`**, for each unacknowledged CRITICAL alarm, **once per alarm id for the life of the page** (never reset, not even at sign-out). Title "KRİTİK Alarm"; body `${bedLabel} · has an unanswered critical alarm`; `tag` = the alarm id (`<patient_id>::<kind>`); `requireInteraction: true`; vibration `[300, 120, 300, 120, 300]`. The page never closes one. **`bedLabel` is the HIS bed label, else the patient id**, so a notification could name a patient identifier (**Needs the user, 2**). A "test notification" button sent a sample.
- **There was no lock screen.** The old build never had to decide what a locked PC does.

**Where it goes, and what each honesty rule decided** (Decisions 16–22):
- **The rule** is in `signals/signals.js`, the ONE copy (amendments, (e)), with a test. It reads `waitingAlarms` (boardStore.js), so "nobody has answered it" is the board store's own `needsAnswer`, floor included. It maps the engine's severity onto the three patterns, worst first, with `SEVERITY_ORDER`'s rule that a severity this build does not know may be the worst. That one point departs from the old build: an unknown severity sounds as critical.
- **Not LIVE.** The old build sounded a DEGRADED board's alarms, so this one does too (**kept, and said**). It is silent on a connecting or unavailable board, as the old one was, its list being empty. Nothing here ever says nothing is waiting: the sound is the only output, and it never claims silence.
- **The sound** comes from `signals/alarmSound.js`, a port of `clinicalAudio.js` with its numbers unchanged. It is an instance, not module state, and it reports the browser's audio state.
- **On the page**, `signals/AlarmSignals.jsx` sits **outside the phases** in `LiveApp.jsx`: the shell is unmounted at the lock, and a locked ward PC must still alert. It is active while `seesBoard(phase, user)`, now one function in `sessionStore.js` that `Phases` uses too: ready or LOCKED, holding `board.view`.
  - **Through the lock:** the sound goes on. Notifications raised while locked name **no bed** (one, `signals.notifyBodyLocked`), and the bed-naming ones are closed at the lock. The lock screen promises numbers only, and an OS notification is not behind it.
  - **At the end of the session** (sign-out, another account, the server ending it): the sound stops and every notification the page raised is closed.
  - **The opt-in** is saved in this browser (`hmc.alarmSound`). A reload no longer quietly turns it off. A browser still starts audio only after a click or a key press, so until one comes a wanted sound is "waiting", and a button on every screen, the lock screen included, says so and starts it. The sign-in or unlock typing starts it too.
- **The opt-in's control** is Task 5 (Settings). Until then the sound is off for everyone, exactly as after any old page load.

**The net forces one task.** `reachable.test.js` fails on any module the page cannot reach. Measured: with the rule and the engine written but not yet mounted it names both files. So the rule, the engine, the provider and its mounting land together.

**Test recipe** (amendments, "useRetryHold as built"): fake timers installed **before** `mount`, `toFake: ["setTimeout","clearTimeout","setInterval","clearInterval","Date"]`, no `shouldAdvanceTime`, and a `flush()` that yields one real event-loop turn. jsdom has no Web Audio and no `Notification`: `fakeAudio.testutil.js` records what was asked of them. Every `mount()` gets the provider from now on; in jsdom it is inert (no Web Audio, no Notification) and the suite's other counts do not move (measured).

- [ ] **Step 1: The shared test fakes.** Create `dashboard/src/live/signals/fakeAudio.testutil.js` with exactly:

```js
// Test-only: a Web Audio and a Notification that record what the page asked of them — jsdom has
// neither — and the window/document switches the alarm signals read. Synthetic; nothing plays.
import { vi } from "vitest";

/** A Web Audio stand-in. Every context starts "suspended", as a browser's does before a gesture;
 *  `resume()` makes it "running" — unless `refuse`, a browser that has seen no real gesture yet
 *  (a test's synthetic click is not one to a real browser). `pulses()` is the frequency of every
 *  tone scheduled so far, in order; `contexts` every context created. */
export function fakeAudio({ refuse = false } = {}) {
  const contexts = [];
  class FakeAudioContext {
    constructor() {
      this.state = "suspended";
      this.currentTime = 0;
      this.destination = { kind: "destination" };
      this.oscillators = [];
      this.onstatechange = null;
      contexts.push(this);
    }

    createGain() {
      return { gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {} };
    }

    createOscillator() {
      const osc = {
        type: "sine",
        frequency: { value: 0 },
        connect() {},
        start(at) { osc.startAt = at; },
        stop(at) { osc.stopAt = at; },
      };
      this.oscillators.push(osc);
      return osc;
    }

    resume() {
      if (refuse) return Promise.resolve();
      this.state = "running";
      this.onstatechange?.();
      return Promise.resolve();
    }

    suspend() {
      this.state = "suspended";
      this.onstatechange?.();
      return Promise.resolve();
    }

    close() {
      this.state = "closed";
      return Promise.resolve();
    }
  }
  return {
    AudioContext: FakeAudioContext,
    contexts,
    pulses: () => contexts.flatMap((c) => c.oscillators.map((o) => o.frequency.value)),
  };
}

/** A Notification stand-in with the browser's static `permission` and `requestPermission`.
 *  `shown` is every notification raised, `open()` those not closed since. */
export function fakeNotifications(permission = "granted", answer = "granted") {
  const shown = [];
  class FakeNotification {
    constructor(title, options = {}) {
      this.title = title;
      this.body = options.body;
      this.options = options;
      this.closed = false;
      shown.push(this);
    }

    close() {
      this.closed = true;
    }
  }
  FakeNotification.permission = permission;
  FakeNotification.requestPermission = vi.fn(async () => {
    FakeNotification.permission = answer;
    return answer;
  });
  return { Notification: FakeNotification, shown, open: () => shown.filter((n) => !n.closed) };
}

/** Put them on the page for one test; the returned function takes them off again. `hidden` is
 *  `document.hidden` — set it with `setHidden(true)` and a `visibilitychange` is dispatched, as the
 *  browser does when another window or tab comes to the front. */
export function onPage({ AudioContext, Notification, secure = true } = {}) {
  const had = {
    AudioContext: Object.getOwnPropertyDescriptor(window, "AudioContext"),
    Notification: Object.getOwnPropertyDescriptor(window, "Notification"),
    isSecureContext: Object.getOwnPropertyDescriptor(window, "isSecureContext"),
  };
  const put = (name, value) => Object.defineProperty(window, name, { configurable: true, writable: true, value });
  if (AudioContext) put("AudioContext", AudioContext);
  if (Notification) put("Notification", Notification);
  put("isSecureContext", secure);
  let hidden = false;
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  return {
    setHidden(value) {
      hidden = value;
      document.dispatchEvent(new Event("visibilitychange"));
    },
    undo() {
      for (const [name, descriptor] of Object.entries(had)) {
        if (descriptor) Object.defineProperty(window, name, descriptor);
        else delete window[name];
      }
      delete document.hidden;
    },
  };
}
```

- [ ] **Step 2: The rule's and the engine's tests.** Create `dashboard/src/live/signals/signals.test.js`:

```js
// Which waiting alarm sounds, and which raises a notification — the ONE copy of that mapping
// (amendments, (e)). What the previous workspace did is the reference (ClinicalDemo.jsx and
// liveAdapters.js at e4cdf15): an unacknowledged alarm sounded by its tier — critical, high and
// moderate each with their own pattern, low and info never — and only a critical one raised a
// notification. Synthetic patients only.
import { describe, it, expect } from "vitest";
import { CONNECTION } from "../../liveConnection.js";
import { alertsFromPatients, patientsFromBoard } from "../../liveAdapters.js";
import { alarm, board, entry } from "../data/board.testutil.js";
import { PATTERNS, notifyFor, patternOf, soundFor } from "./signals.js";

/** The board's state as `useBoard()` gives it: each alarm on its own synthetic patient. */
const ward = (alarms, connection = CONNECTION.LIVE) => ({
  alerts: alertsFromPatients(patientsFromBoard(board(alarms.map((a, i) => entry(`S-00${i + 1}`, [a]))))),
  connection,
});

describe("the pattern an alarm asks for", () => {
  it("maps the engine's severity as the previous workspace did: three patterns, low and info silent", () => {
    expect(PATTERNS).toEqual(["critical", "high", "moderate"]);
    expect(patternOf({ severity: "critical" })).toBe("critical");
    expect(patternOf({ severity: "high" })).toBe("high");
    expect(patternOf({ severity: "moderate" })).toBe("moderate");
    expect(patternOf({ severity: "low" })).toBeNull();
    expect(patternOf({ severity: "info" })).toBeNull();
  });

  // The previous workspace was silent here (its tier was null). This build reads a severity it
  // cannot account for as possibly the worst — SEVERITY_ORDER sorts it first, the bell counts it —
  // and a ward PC that stays quiet for a possibly-critical alarm is the worse failure of the two.
  it("sounds a severity this build does not know, or none, as critical", () => {
    expect(patternOf({ severity: "catastrophic" })).toBe("critical");
    expect(patternOf({ severity: null })).toBe("critical");
    expect(patternOf({})).toBe("critical");
  });
});

describe("what the page plays", () => {
  it("plays the worst pattern among the alarms nobody has answered", () => {
    expect(soundFor(ward([alarm("a", "moderate"), alarm("b", "high")]))).toBe("high");
    expect(soundFor(ward([alarm("a", "high"), alarm("b", "critical"), alarm("c", "low")]))).toBe("critical");
    expect(soundFor(ward([alarm("a", "low"), alarm("b", "info")]))).toBeNull();
  });

  it("is silent for an acknowledged alarm — and for a chronic-expected low one", () => {
    expect(soundFor(ward([alarm("a", "critical", { acknowledged: true, acknowledged_by: "ayse" })]))).toBeNull();
    expect(soundFor(ward([alarm("a", "moderate", { downgraded: true })]))).toBeNull();
  });

  it("still sounds a downgraded critical or high: the waiting queue's floor", () => {
    expect(soundFor(ward([alarm("a", "critical", { downgraded: true })]))).toBe("critical");
    expect(soundFor(ward([alarm("a", "high", { downgraded: true })]))).toBe("high");
  });

  // The previous workspace's store KEPT its alarms when the stream dropped, and went on sounding
  // them; it emptied them only when a load failed or the session ended. The same here: a DEGRADED
  // board plays what it last had, a board that cannot say what is open plays nothing.
  it("plays on a board whose stream dropped, and nothing on one that cannot say what is open", () => {
    const open = [alarm("a", "critical")];
    expect(soundFor(ward(open, CONNECTION.DEGRADED))).toBe("critical");
    expect(soundFor(ward(open, CONNECTION.CONNECTING))).toBeNull();
    expect(soundFor(ward(open, CONNECTION.UNAVAILABLE))).toBeNull();
    expect(soundFor({})).toBeNull();
  });
});

describe("what raises a notification", () => {
  it("only a waiting alarm whose pattern is critical, each by its own id", () => {
    const { items, known } = notifyFor(ward([
      alarm("a", "critical"), alarm("b", "high"), alarm("c", "critical", { acknowledged: true }), alarm("d", "mystery"),
    ]));
    expect(known).toBe(true);
    expect(items.map((a) => a.id)).toEqual(["S-004::d", "S-001::a"]);
  });

  it("names nothing it cannot know, and says whether the board is LIVE", () => {
    expect(notifyFor(ward([alarm("a", "critical")], CONNECTION.UNAVAILABLE))).toEqual({ known: false, items: [] });
    const stale = notifyFor(ward([alarm("a", "critical")], CONNECTION.DEGRADED));
    expect(stale.known).toBe(false);
    expect(stale.items).toHaveLength(1);
  });
});
```

Create `dashboard/src/live/signals/alarmSound.test.js`:

```js
// The alarm sound, ported from the previous workspace's clinicalAudio.js (e4cdf15) with its numbers
// unchanged — what a ward has been hearing on the VM's build. jsdom has no Web Audio: a fake context
// records every tone (fakeAudio.testutil.js), and fake timers stand in for the repeat.
import { describe, it, expect, vi, afterEach } from "vitest";
import { PROFILES, createAlarmSound } from "./alarmSound.js";
import { fakeAudio } from "./fakeAudio.testutil.js";

afterEach(() => {
  vi.useRealTimers();
});

const timers = () => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });

async function running() {
  const audio = fakeAudio();
  const sound = createAlarmSound({ win: { AudioContext: audio.AudioContext } });
  await sound.resume();
  return { audio, sound };
}

describe("the three patterns", () => {
  it("are the previous workspace's, number for number", () => {
    expect(PROFILES.critical).toEqual({ freq: 960, pulses: 10, pulseMs: 150, gapMs: 100, repeatMs: 2500, vol: 0.5, groupAfter: 5, groupGapMs: 350 });
    expect(PROFILES.high).toEqual({ freq: 640, pulses: 3, pulseMs: 180, gapMs: 150, repeatMs: 12000, vol: 0.4, groupAfter: 0, groupGapMs: 0 });
    expect(PROFILES.moderate).toEqual({ freq: 500, pulses: 3, pulseMs: 200, gapMs: 220, repeatMs: 20000, vol: 0.3, groupAfter: 0, groupGapMs: 0 });
    expect(Object.isFrozen(PROFILES) && Object.isFrozen(PROFILES.critical)).toBe(true);
  });
});

describe("createAlarmSound", () => {
  it("says so when the browser has no Web Audio, and does nothing", async () => {
    const sound = createAlarmSound({ win: {} });
    expect(sound.state()).toBe("unsupported");
    expect(await sound.resume()).toBe(false);
    expect(sound.play("critical")).toBe(false);
    expect(sound.playing()).toBeNull();
  });

  it("plays nothing before a gesture has started the audio: the context is suspended", () => {
    const audio = fakeAudio();
    const sound = createAlarmSound({ win: { AudioContext: audio.AudioContext } });
    expect(sound.state()).toBe("suspended");
    expect(sound.play("critical")).toBe(false);
    expect(audio.pulses()).toEqual([]);
  });

  it("plays a critical burst of ten pulses at 960 Hz, five and five, and repeats it every 2.5 s", async () => {
    timers();
    const { audio, sound } = await running();
    expect(sound.play("critical")).toBe(true);
    expect(sound.playing()).toBe("critical");
    expect(audio.pulses()).toEqual(Array(10).fill(960));
    const starts = audio.contexts[0].oscillators.map((o) => o.startAt);
    // 250 ms apart, and the IEC group gap (350 ms more) after the fifth.
    expect(starts[1] - starts[0]).toBeCloseTo(0.25);
    expect(starts[5] - starts[4]).toBeCloseTo(0.6);
    vi.advanceTimersByTime(2499);
    expect(audio.pulses()).toHaveLength(10);
    vi.advanceTimersByTime(1);
    expect(audio.pulses()).toHaveLength(20);
  });

  it("does not restart a pattern already playing, and switches to another one", async () => {
    timers();
    const { audio, sound } = await running();
    sound.play("high");
    sound.play("high");
    expect(audio.pulses()).toEqual([640, 640, 640]);
    sound.play("moderate");
    expect(audio.pulses()).toEqual([640, 640, 640, 500, 500, 500]);
    vi.advanceTimersByTime(12000);                     // the old high repeat is gone
    expect(audio.pulses()).toHaveLength(6);
    vi.advanceTimersByTime(8000);                      // the moderate one comes every 20 s
    expect(audio.pulses()).toHaveLength(9);
  });

  it("stops: no more bursts", async () => {
    timers();
    const { audio, sound } = await running();
    sound.play("critical");
    sound.stop();
    expect(sound.playing()).toBeNull();
    vi.advanceTimersByTime(10000);
    expect(audio.pulses()).toHaveLength(10);
  });

  it("treats a pattern it does not know as silence, and stops what was playing", async () => {
    const { audio, sound } = await running();
    sound.play("critical");
    expect(sound.play("loud")).toBe(false);
    expect(sound.playing()).toBeNull();
    expect(audio.pulses()).toHaveLength(10);
  });

  it("tells the page when the browser suspends the audio, and stops", async () => {
    const audio = fakeAudio();
    const changes = [];
    const sound = createAlarmSound({ win: { AudioContext: audio.AudioContext }, onState: (s) => changes.push(s) });
    await sound.resume();
    sound.play("high");
    await audio.contexts[0].suspend();
    expect(changes).toEqual(["running", "suspended"]);
    expect(sound.playing()).toBeNull();
  });

  it("plays one burst on request — the settings screen's test — and nothing after it", async () => {
    timers();
    const { audio, sound } = await running();
    expect(sound.test()).toBe(true);
    expect(audio.pulses()).toEqual(Array(10).fill(960));
    vi.advanceTimersByTime(10000);
    expect(audio.pulses()).toHaveLength(10);
    expect(sound.playing()).toBeNull();
  });
});
```

```bash
cd /c/tmp/g116-impl/dashboard
npx vitest run src/live/signals/ 2>&1 | grep -E "Error|Test Files|Tests "
```
Expected: `Error: Failed to resolve import "./alarmSound.js" …` and `… "./signals.js" …`, `Test Files  2 failed (2)`, `Tests  no tests`.

- [ ] **Step 3: The rule and the engine.** Create `dashboard/src/live/signals/signals.js`:

```js
// src/live/signals/signals.js — which waiting alarm the page sounds, and which raises a
// notification. The ONE copy of this mapping (amendments, (e)): the sound and the notification both
// read it, and signals.test.js holds it.
//
// It decides nothing clinical. It takes the alarms the board store already calls waiting
// (`waitingAlarms`: nobody has acknowledged them, and the engine has not marked them chronic-
// expected — with the floor that keeps a downgraded critical or high waiting) and maps the engine's
// own severity onto the three patterns the previous workspace played (clinicalAudio.js, its `tier`
// from liveAdapters.js; both readable at e4cdf15). A severity this build does not know sounds as
// critical, because `SEVERITY_ORDER` reads it as possibly the worst; the previous workspace was
// silent there, and that is the one place this mapping departs from it.
import { SEVERITY_ORDER, waitingAlarms } from "../data/boardStore.js";

/** The patterns, worst first: IEC 60601-1-8's high, medium and low priority as the previous
 *  workspace named them after the engine's severities. */
export const PATTERNS = Object.freeze(["critical", "high", "moderate"]);

const PATTERN_OF = Object.freeze({ critical: "critical", high: "high", moderate: "moderate", low: null, info: null });

/** The pattern one alarm asks for, or null for low and info. */
export function patternOf(alarm) {
  const severity = alarm?.severity;
  return SEVERITY_ORDER.includes(severity) ? PATTERN_OF[severity] : "critical";
}

/** What the page plays now: the worst pattern among the alarms somebody must answer, or null.
 *  A DEGRADED board plays what it last had — the previous workspace's store kept its alarms when
 *  the stream dropped and went on sounding them; a board that cannot say what is open plays
 *  nothing (`waitingAlarms` gives it no items). */
export function soundFor(board) {
  const { items } = waitingAlarms(board ?? {});
  let worst = null;
  for (const alarm of items ?? []) {
    const pattern = patternOf(alarm);
    if (pattern && (worst === null || PATTERNS.indexOf(pattern) < PATTERNS.indexOf(worst))) worst = pattern;
  }
  return worst;
}

/** The alarms a notification is raised for — the waiting ones whose pattern is critical, as the
 *  previous workspace raised them for its CRITICAL tier only — and whether the board is LIVE
 *  (`known`): only a LIVE board may say an alarm is no longer waiting. */
export function notifyFor(board) {
  const { known, items } = waitingAlarms(board ?? {});
  return { known, items: (items ?? []).filter((alarm) => patternOf(alarm) === "critical") };
}
```

Create `dashboard/src/live/signals/alarmSound.js`:

```js
// src/live/signals/alarmSound.js — the alarm sound, synthesised in the browser (Web Audio).
//
// A port of the previous workspace's clinicalAudio.js (G1-16 removed it; readable at e4cdf15), with
// its numbers unchanged: it is what a ward has been hearing on the VM's build. No sound file — each
// pattern is square-wave pulses in IEC 60601-1-8's burst structure: critical, ten pulses (five and
// five) every 2.5 s; high, three every 12 s; moderate, three every 20 s. Which pattern plays, and
// when, is decided elsewhere (signals.js, AlarmSignals.jsx); this only makes the noise.
//
// Two differences from the old module, both about saying what is true. It is an instance, not
// module state, so a test or a second page cannot inherit another's context. And it reports the
// context's state ("unsupported" | "suspended" | "running"): a browser starts audio only after a
// click or a key press, and a page that believed it was sounding while its context sat suspended
// would be the quietest failure this feature has.

export const PROFILES = Object.freeze({
  critical: Object.freeze({ freq: 960, pulses: 10, pulseMs: 150, gapMs: 100, repeatMs: 2500, vol: 0.5, groupAfter: 5, groupGapMs: 350 }),
  high: Object.freeze({ freq: 640, pulses: 3, pulseMs: 180, gapMs: 150, repeatMs: 12000, vol: 0.4, groupAfter: 0, groupGapMs: 0 }),
  moderate: Object.freeze({ freq: 500, pulses: 3, pulseMs: 200, gapMs: 220, repeatMs: 20000, vol: 0.3, groupAfter: 0, groupGapMs: 0 }),
});

/** `win` is the page's window (a test passes its own); `onState` hears the context's state change —
 *  a gesture started it, or the browser suspended it. */
export function createAlarmSound({ win = typeof window === "undefined" ? undefined : window, onState } = {}) {
  const AudioContextImpl = win?.AudioContext || win?.webkitAudioContext;
  let ctx = null;
  let master = null;
  let current = null;
  let timer = null;

  function state() {
    if (!AudioContextImpl) return "unsupported";
    return ctx?.state === "running" ? "running" : "suspended";
  }

  function context() {
    if (!AudioContextImpl) return null;
    if (!ctx) {
      ctx = new AudioContextImpl();
      master = ctx.createGain();
      master.gain.value = 1;
      master.connect(ctx.destination);
      ctx.onstatechange = () => {
        if (ctx.state !== "running") stop();
        onState?.(state());
      };
    }
    return ctx;
  }

  // One pulse: a fast attack, a short hold, a decay (the old module's envelope, unchanged).
  function pulse(at, profile) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.value = profile.freq;
    const duration = profile.pulseMs / 1000;
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(profile.vol, at + 0.01);
    gain.gain.setValueAtTime(profile.vol, at + duration - 0.03);
    gain.gain.linearRampToValueAtTime(0, at + duration);
    osc.connect(gain);
    gain.connect(master);
    osc.start(at);
    osc.stop(at + duration + 0.02);
  }

  function burst(profile) {
    let at = ctx.currentTime + 0.02;
    for (let i = 0; i < profile.pulses; i += 1) {
      pulse(at, profile);
      at += (profile.pulseMs + profile.gapMs) / 1000;
      if (profile.groupAfter && i + 1 === profile.groupAfter) at += profile.groupGapMs / 1000;
    }
  }

  function stop() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    current = null;
  }

  return {
    state,

    /** Start the audio. Call it from a click or a key press: browsers refuse it otherwise.
     *  Resolves true once the context is running. */
    async resume() {
      const c = context();
      if (!c) return false;
      try {
        await c.resume();
      } catch {
        // Refused (no gesture): the state says so.
      }
      return state() === "running";
    },

    /** Play a pattern until told otherwise; the same pattern again changes nothing. Returns whether
     *  it is sounding: never while the context is suspended, never for a pattern it does not know. */
    play(pattern) {
      const profile = PROFILES[pattern];
      if (!profile || state() !== "running") {
        stop();
        return false;
      }
      if (current === pattern) return true;
      stop();
      current = pattern;
      burst(profile);
      const again = () => {
        burst(profile);
        timer = setTimeout(again, profile.repeatMs);
      };
      timer = setTimeout(again, profile.repeatMs);
      return true;
    },

    stop,

    /** One critical burst and nothing after it: the settings screen's "test the sound". */
    test() {
      if (state() !== "running") return false;
      burst(PROFILES.critical);
      return true;
    },

    /** The pattern sounding now, or null. */
    playing: () => current,

    close() {
      stop();
      ctx?.close?.();
      ctx = null;
    },
  };
}
```

```bash
cd /c/tmp/g116-impl/dashboard
npx vitest run src/live/signals/ 2>&1 | grep -E "Test Files|Tests "
npx vitest run src/reachable.test.js 2>&1 | grep -E "Tests |\+   \""
```
Expected: `Test Files  2 passed (2)`, `Tests  17 passed (17)` (rule 8, engine 9). Then `Tests  1 failed | 2 passed (3)`, naming `"live/signals/alarmSound.js"` and `"live/signals/signals.js"`: the net refusing two modules no page reaches yet. The next steps reach them. Do not commit here.

- [ ] **Step 4: The provider's tests, and the page's.** Create `dashboard/src/live/signals/AlarmSignals.test.jsx`:

```jsx
// The alarm sound and the critical-alarm notification on the page, over a real session store and a
// real board store on a fake API (mount.testutil.jsx). What the previous workspace did is the
// reference (ClinicalDemo.jsx 4242-4320 and clinicalAudio.js, e4cdf15); what it never had to do —
// sound through a lock, stop at sign-out — is new, and is held here. jsdom has no Web Audio and no
// Notification: fakeAudio.testutil.js records what was asked of them. Synthetic patients only.
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";
import { mount } from "../session/mount.testutil.jsx";
import { alarm, board, entry, identity } from "../data/board.testutil.js";
import { useAlarmSignals } from "./AlarmSignals.jsx";
import { fakeAudio, fakeNotifications, onPage } from "./fakeAudio.testutil.js";

const realSetTimeout = globalThis.setTimeout;
const flush = () => act(() => new Promise((resolve) => { realSetTimeout(resolve, 0); }));
const tick = (ms) => act(() => { vi.advanceTimersByTime(ms); });
const WAITING = "Siqnal səsi gözləmədədir — açmaq üçün klikləyin";

let page = null;
afterEach(() => {
  page?.undo();
  page = null;
  vi.restoreAllMocks();
  vi.useRealTimers();
  localStorage.clear();
});

function Probe() {
  const { sound, notify, askNotify } = useAlarmSignals();
  return (
    <>
      <p data-testid="signals">{`${sound} ${notify}`}</p>
      <button type="button" onClick={askNotify}>ask</button>
    </>
  );
}

const reaBed = (id, alarms, over = {}) => entry(id, alarms, { identity: identity({ patient_id: id, bed_label: "REA-01 · 2" }), ...over });

/** A LIVE ward, with the sound wanted (or not) and notifications allowed (or not). Fake timers are
 *  installed first, as the house recipe says (amendments, useRetryHold), so the repeat is driven. */
async function ward(patients, { sound = true, permission = "granted", secure = true, load } = {}) {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  if (sound) localStorage.setItem("hmc.alarmSound", "on");
  const audio = fakeAudio();
  const notes = fakeNotifications(permission);
  page = onPage({ AudioContext: audio.AudioContext, Notification: notes.Notification, secure });
  const view = await mount(<Probe />, { setup: (api) => {
    if (load) load(api);
    else api.boardPatients.mockResolvedValue(board(patients));
    api.streamTicket.mockResolvedValue({ ticket: "t-1" });
  } });
  await act(async () => { view.board.start(); });
  await flush();
  await act(async () => { view.stream.open(); });
  await flush();
  return { ...view, audio, notes };
}

const state = () => screen.getByTestId("signals").textContent;

describe("the alarm sound", () => {
  it("is off unless someone turned it on — a critical alarm plays nothing", async () => {
    const { audio } = await ward([reaBed("S-001", [alarm("septic_shock", "critical")])], { sound: false });
    fireEvent.click(document.body);
    await flush();
    expect(state()).toBe("off granted");
    expect(audio.pulses()).toEqual([]);
    expect(screen.queryByRole("button", { name: WAITING })).toBeNull();
  });

  it("waits for a click, says so, then plays the worst waiting pattern", async () => {
    const { audio } = await ward([
      reaBed("S-001", [alarm("news2", "high")]), reaBed("S-002", [alarm("septic_shock", "critical")]),
    ]);
    expect(state()).toBe("waiting granted");
    expect(audio.pulses()).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: WAITING }));
    await flush();
    expect(state()).toBe("on granted");
    expect(audio.pulses()).toEqual(Array(10).fill(960));
    expect(screen.queryByRole("button", { name: WAITING })).toBeNull();
  });

  it("is started by any key press too — typing the unlock password counts", async () => {
    const { audio } = await ward([reaBed("S-001", [alarm("news2", "high")])]);
    fireEvent.keyDown(document.body, { key: "a" });
    await flush();
    expect(audio.pulses()).toEqual([640, 640, 640]);
  });

  it("stops when the alarm is answered", async () => {
    const { audio, stream } = await ward([reaBed("S-001", [alarm("septic_shock", "critical")])]);
    fireEvent.click(document.body);
    await flush();
    act(() => { stream.frame(reaBed("S-001", [alarm("septic_shock", "critical", { acknowledged: true, acknowledged_by: "ayse" })])); });
    tick(10000);
    expect(audio.pulses()).toHaveLength(10);
  });

  it("goes on through a lock — the shell is gone, the alarm is not", async () => {
    const { audio, store } = await ward([reaBed("S-001", [alarm("septic_shock", "critical")])]);
    fireEvent.click(document.body);
    await flush();
    await act(async () => { store.lock(); });
    tick(2500);
    expect(audio.pulses()).toHaveLength(20);
  });

  it("stops when the session ends", async () => {
    const { audio, store } = await ward([reaBed("S-001", [alarm("septic_shock", "critical")])]);
    fireEvent.click(document.body);
    await flush();
    await act(async () => { store.signOut(); });
    await flush();
    tick(10000);
    expect(audio.pulses()).toHaveLength(10);
  });

  it("goes on with what the board last had when the stream drops — as the old store did", async () => {
    const { audio, stream } = await ward([reaBed("S-001", [alarm("septic_shock", "critical")])]);
    fireEvent.click(document.body);
    await flush();
    act(() => { stream.drop(); });
    tick(2500);
    expect(audio.pulses()).toHaveLength(20);
  });

  it("plays nothing for a board that cannot say what is open", async () => {
    const { audio } = await ward([], { load: (api) => api.boardPatients.mockRejectedValue(new Error("down")) });
    fireEvent.click(document.body);
    await flush();
    expect(state()).toBe("on granted");
    expect(audio.pulses()).toEqual([]);
  });

  it("follows another tab of this browser turning it off", async () => {
    const { audio } = await ward([reaBed("S-001", [alarm("septic_shock", "critical")])]);
    fireEvent.click(document.body);
    await flush();
    localStorage.setItem("hmc.alarmSound", "off");
    act(() => { window.dispatchEvent(new StorageEvent("storage", { key: "hmc.alarmSound", newValue: "off" })); });
    tick(10000);
    expect(state()).toBe("off granted");
    expect(audio.pulses()).toHaveLength(10);
  });
});

describe("the critical-alarm notification", () => {
  it("is raised once per critical alarm while the page is in the background, naming its bed", async () => {
    const { notes, stream } = await ward([
      reaBed("S-001", [alarm("septic_shock", "critical")]), reaBed("S-002", [alarm("news2", "high")]),
    ], { sound: false });
    expect(notes.shown).toHaveLength(0);                 // the page is in front: the screen says it
    act(() => { page.setHidden(true); });
    expect(notes.shown).toHaveLength(1);
    expect(notes.shown[0].title).toBe("Kritik siqnal");
    expect(notes.shown[0].body).toBe("REA-01 · 2 — cavab gözləyən kritik siqnal");
    expect(notes.shown[0].options.requireInteraction).toBe(true);
    act(() => { stream.frame(reaBed("S-001", [alarm("septic_shock", "critical")], { risk: "critical" })); });
    expect(notes.shown).toHaveLength(1);                 // the same alarm: not again
  });

  // Over a board whose stream has dropped: a LIVE board would close the bed's notification anyway
  // (the alarm's key is not wanted while locked), so only a DEGRADED one shows that the LOCK does it.
  it("names no bed while the screen is locked — the one that did is closed at the lock", async () => {
    const { notes, store, stream } = await ward([reaBed("S-001", [alarm("septic_shock", "critical")])], { sound: false });
    act(() => { page.setHidden(true); });
    act(() => { stream.drop(); });
    await act(async () => { store.lock(); });
    expect(notes.shown[0].closed).toBe(true);
    expect(notes.open()).toHaveLength(1);
    expect(notes.open()[0].body).toBe("Cavab gözləyən kritik siqnal var. Ətraflı məlumat üçün ekranın kilidini açın.");
    expect(document.body).not.toHaveTextContent("REA-01");
  });

  it("is closed when a LIVE board says the alarm was answered, and all of them when the session ends", async () => {
    const { notes, stream, store } = await ward([
      reaBed("S-001", [alarm("septic_shock", "critical")]), reaBed("S-002", [alarm("septic_shock", "critical")]),
    ], { sound: false });
    act(() => { page.setHidden(true); });
    expect(notes.open()).toHaveLength(2);
    act(() => { stream.frame(reaBed("S-001", [alarm("septic_shock", "critical", { acknowledged: true })])); });
    expect(notes.open()).toHaveLength(1);
    await act(async () => { store.signOut(); });
    expect(notes.open()).toHaveLength(0);
  });

  it("asks for permission only when asked, and says what the browser answered", async () => {
    const { notes } = await ward([], { sound: false, permission: "default" });
    expect(state()).toBe("off default");
    expect(notes.Notification.requestPermission).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "ask" }));
    await flush();
    expect(state()).toBe("off granted");
  });

  it("says so when the page is not on a secure address, where the browser refuses notifications", async () => {
    await ward([], { sound: false, permission: "default", secure: false });
    expect(state()).toBe("off insecure");
  });
});
```

Edit `dashboard/src/live/LiveApp.test.jsx`. Replace:
```js
import { ANNOUNCE_DELAY_MS, useToast } from "./ui/index.js";
```
with:
```js
import { ANNOUNCE_DELAY_MS, useToast } from "./ui/index.js";
import { fakeAudio, onPage } from "./signals/fakeAudio.testutil.js";
```

Edit `dashboard/src/live/LiveApp.test.jsx`. Replace:
```jsx
  it("lets someone else sign in instead, with no password", async () => {
```
with:
```jsx
  // The alarm sound sits outside the phases (signals/AlarmSignals.jsx): the shell is unmounted at the
  // lock, and a locked ward PC must still alert. Proved on the whole page: an alarm that arrives
  // while the screen is locked changes what plays.
  it("keeps the alarm sound going through the lock — a critical alarm arriving then is heard", async () => {
    localStorage.setItem("hmc.alarmSound", "on");
    const audio = fakeAudio();
    const page = onPage({ AudioContext: audio.AudioContext });
    try {
      const api = fakeApi(vi, { access: null });
      api.boardPatients.mockResolvedValue(BOARD);
      api.streamTicket.mockResolvedValue({ ticket: "t-1" });
      let stream = null;
      const openStream = vi.fn((url, handlers) => {
        stream = handlers;
        Promise.resolve().then(() => handlers.onopen());
        return () => {};
      });
      render(<LiveApp api={api} openStream={openStream} />);
      await signIn(api);                                  // its click is the gesture that starts the audio
      await screen.findByRole("heading", { level: 1, name: "Ayarlar" });
      await waitFor(() => expect(audio.pulses()).toEqual([640, 640, 640]));   // REA-01's high alarm
      fireEvent.click(screen.getByRole("button", { name: "Hesab menyusu" }));
      fireEvent.click(screen.getByRole("menuitem", { name: "Ekranı kilidlə" }));
      await screen.findByRole("heading", { level: 1, name: "Ekran kilidlənib" });
      act(() => {
        stream.onmessage({ data: JSON.stringify({ patient_id: "P-002", risk: "critical", vitals: {}, alerts: [
          { kind: "septic_shock", severity: "critical", summary: "sintetik", first_seen_at: "2026-10-04T08:01:00Z", acknowledged: false },
        ] }) });
      });
      await waitFor(() => expect(audio.pulses().slice(3)).toEqual(Array(10).fill(960)));
    } finally {
      page.undo();
    }
  });

  it("lets someone else sign in instead, with no password", async () => {
```

```bash
cd /c/tmp/g116-impl/dashboard
npx vitest run src/live/signals/AlarmSignals.test.jsx 2>&1 | grep -E "Error|Tests "
npx vitest run src/live/LiveApp.test.jsx -t "keeps the alarm sound" 2>&1 | grep -E "→|Tests "
```
Expected: `Error: Failed to resolve import "./AlarmSignals.jsx" …`, `Tests  no tests`; then `→ expected [] to deeply equal [ 640, 640, 640 ]`, `Tests  1 failed | 35 skipped (36)`. Nothing on the page plays yet.

- [ ] **Step 5: Its texts, in four languages.** Create `dashboard/src/live/i18n/strings/signals.js`:

```js
// The alarm sound and the critical-alarm notification (G1-16: ported from the previous workspace
// before it was deleted). The previous workspace's own texts were the source — clinicalI18n.js
// pr7.soundOn/notifyTitle/notifyBody, pr8.notifyBanner*/testPush* (readable at e4cdf15) — reworded
// in this UI's vocabulary ("siqnal", "cavab gözləyən"), and with two of its claims dropped because
// they were not true: notifications do NOT arrive "when the tab is closed" (there is no push
// service; the page itself raises them), and they are not "with sound and vibration" on a PC.
// A notification raised while the screen is LOCKED names no bed (`notifyBodyLocked`): the lock
// screen shows numbers only, and the operating system's notification is outside it.
// AZ/RU/EN await a native-speaking clinician's review before the pilot.
export default {
  tr: {
    notifyTitle: "Kritik alarm",
    notifyBody: "{bed} — yanıt bekleyen kritik alarm",
    notifyBodyLocked: "Yanıt bekleyen kritik alarm var. Ayrıntı için ekranın kilidini açın.",
    testTitle: "Homunculus · deneme",
    testBody: "Bildirimler çalışıyor. Kritik bir alarm böyle gelir.",
    soundWaiting: "Alarm sesi beklemede — açmak için tıklayın",
  },
  az: {
    notifyTitle: "Kritik siqnal",
    notifyBody: "{bed} — cavab gözləyən kritik siqnal",
    notifyBodyLocked: "Cavab gözləyən kritik siqnal var. Ətraflı məlumat üçün ekranın kilidini açın.",
    testTitle: "Homunculus · yoxlama",
    testBody: "Bildirişlər işləyir. Kritik siqnal belə gəlir.",
    soundWaiting: "Siqnal səsi gözləmədədir — açmaq üçün klikləyin",
  },
  ru: {
    notifyTitle: "Критическая тревога",
    notifyBody: "Койка {bed}: критическая тревога ждёт ответа",
    notifyBodyLocked: "Критическая тревога ждёт ответа. Разблокируйте экран, чтобы увидеть подробности.",
    testTitle: "Homunculus · проверка",
    testBody: "Уведомления работают. Так придёт критическая тревога.",
    soundWaiting: "Звук тревоги ожидает — нажмите, чтобы включить",
  },
  en: {
    notifyTitle: "Critical alarm",
    notifyBody: "{bed} — critical alarm awaiting a response",
    notifyBodyLocked: "A critical alarm is awaiting a response. Unlock the screen for details.",
    testTitle: "Homunculus · test",
    testBody: "Notifications are working. A critical alarm will arrive like this.",
    soundWaiting: "Alarm sound is waiting — click to turn it on",
  },
};
```

Edit `dashboard/src/live/i18n/catalog.js`. Replace:
```js
import source from "./strings/source.js";

export const NAMESPACES = {
```
with:
```js
import source from "./strings/source.js";

// G1-16: the alarm sound and the critical-alarm notification, ported before the old workspace went.
import signals from "./strings/signals.js";

export const NAMESPACES = {
```

Edit `dashboard/src/live/i18n/catalog.js`. Replace:
```js
  source,
};
```
with:
```js
  source,

  signals,
};
```

No Azerbaijani text equals its Turkish source, and none is language-neutral, so `strings.test.js` needs no new entry (it stays at 6).

- [ ] **Step 6: One rule for "this session may see the board", and the provider outside the phases.** Edit `dashboard/src/live/session/sessionStore.js`. Replace:
```js
});

/** Why the sign-in form opened (`state.notice.code`); each has an `auth.notice.*` text. */
```
with:
```js
});

/** Whether a session may see the board now: ready or LOCKED — the lock screen counts the open
 *  alarms, and a locked ward PC still sounds them — and holding `board.view`. LiveApp starts and
 *  clears the board by it, and the alarm signals sound by it (signals/AlarmSignals.jsx): one rule,
 *  so the two cannot disagree about whether a ward is being watched. */
export function seesBoard(phase, user) {
  return (phase === PHASE.READY || phase === PHASE.LOCKED) && Boolean(user?.perms?.includes("board.view"));
}

/** Why the sign-in form opened (`state.notice.code`); each has an `auth.notice.*` text. */
```

Edit `dashboard/src/live/LiveApp.jsx`. Replace:
```jsx
  const open = phase === PHASE.READY || phase === PHASE.LOCKED;
  const watch = open && Boolean(user?.perms.includes("board.view"));
```
with:
```jsx
  const watch = seesBoard(phase, user);
```

Edit `dashboard/src/live/LiveApp.jsx`. Replace:
```jsx
import { FALLBACK_LOCK_MINUTES, PHASE, createSessionStore } from "./session/sessionStore.js";
```
with:
```jsx
import { FALLBACK_LOCK_MINUTES, PHASE, createSessionStore, seesBoard } from "./session/sessionStore.js";
```

Edit `dashboard/src/live/LiveApp.jsx`. Replace:
```jsx
import { BoardProvider } from "./data/BoardProvider.jsx";
import { createBoardStore } from "./data/boardStore.js";
```
with:
```jsx
import { BoardProvider } from "./data/BoardProvider.jsx";
import { createBoardStore } from "./data/boardStore.js";
import { AlarmSignals } from "./signals/AlarmSignals.jsx";
```

Edit `dashboard/src/live/LiveApp.jsx`. Replace:
```jsx
          <BoardProvider store={board}>
            <Phases board={board} />
          </BoardProvider>
```
with:
```jsx
          <BoardProvider store={board}>
            {/* Outside the phases: the sound goes on through a lock (the shell is unmounted then)
                and stops when the session ends (signals/AlarmSignals.jsx). */}
            <AlarmSignals>
              <Phases board={board} />
            </AlarmSignals>
          </BoardProvider>
```

Edit `dashboard/src/live/LiveApp.jsx`. Replace:
```jsx
// back with it, and are dropped when the session ends (ui/Toast.jsx). Every per-user thing the page
// held goes with the session (sessionStore.js `end`).
```
with:
```jsx
// back with it, and are dropped when the session ends (ui/Toast.jsx). Every per-user thing the page
// held goes with the session (sessionStore.js `end`). The alarm sound and the critical-alarm
// notification sit outside the phases (signals/AlarmSignals.jsx): a lock does not silence them, the
// end of the session does.
```

`open` had no other use in `LiveApp.jsx` (checked with `grep -n "\bopen\b"`): the `open` prop of `ToastProvider` is a separate expression.

- [ ] **Step 7: The provider.** Create `dashboard/src/live/signals/AlarmSignals.jsx`:

```jsx
// src/live/signals/AlarmSignals.jsx — the alarm sound and the critical-alarm notification, on the
// page. Ported (G1-16) from the previous workspace's ClinicalDemo.jsx and clinicalAudio.js before
// they were deleted (readable at e4cdf15); the VM's build behaves as those do.
//
// What the previous workspace did, and what this keeps:
//   * The sound is OPT-IN (it was a top-bar button, off on every page load). Here the choice is in
//     Settings and is kept in this browser (`hmc.alarmSound`) — a ward PC is the alarm station,
//     not a person's — so a reload does not quietly turn it off. A browser still starts audio only
//     after a click or a key press: until one happens a wanted sound is "waiting", and a button on
//     every screen, the lock screen included, says so and starts it.
//   * It plays the worst pattern among the alarms nobody has answered (signals.js), until they are
//     answered — the old one also honoured a snooze, which the live system does not have. On a
//     board whose stream has dropped it plays what the board last had, as the old store kept its
//     alarms then; on a board that cannot say what is open it plays nothing.
//   * A notification is raised for each critical alarm while the page is in the background
//     (`document.hidden`), once per alarm, staying until dismissed (`requireInteraction`), with the
//     old vibration pattern. Its text names the alarm's bed — the HIS bed label, else the patient id
//     (liveAdapters.js `bedLabel`), exactly as the old one did.
// What is new, because the old workspace had no lock screen and never ended a sound at sign-out:
//   * It sits OUTSIDE the phases (LiveApp.jsx): the shell is unmounted when the screen locks, and a
//     locked ward PC must still alert. The board runs while locked (`seesBoard`), so does the sound.
//   * While locked a notification names no bed (`signals.notifyBodyLocked`), and the ones that did
//     are closed at the lock: the lock screen shows numbers only, and the OS notification is not
//     behind it.
//   * When the session ends — sign-out, another account, the server ending it — the sound stops and
//     every notification this page raised is closed. A notification is also closed once a LIVE
//     board says its alarm no longer waits.
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useBoard } from "../data/BoardProvider.jsx";
import { useI18n } from "../i18n/I18nProvider.jsx";
import { PREF_PREFIX, readPref, writePref } from "../prefs.js";
import { useSession } from "../session/SessionProvider.jsx";
import { PHASE, seesBoard } from "../session/sessionStore.js";
import { Button } from "../ui/index.js";
import { createAlarmSound } from "./alarmSound.js";
import { notifyFor, soundFor } from "./signals.js";

/** The per-browser choice: "on" | "off", off unless someone turned it on. */
export const SOUND_PREF = "alarmSound";
const SOUND_CHOICES = ["on", "off"];
/** What counts as the user's gesture for a browser's autoplay rule. */
const GESTURES = ["pointerdown", "keydown", "click"];
/** The previous workspace's vibration for a critical alarm (a phone or tablet only). */
export const VIBRATE = Object.freeze([300, 120, 300, 120, 300]);
/** The one notification raised while locked: it names no bed, so one stands for all of them. */
const LOCKED = "locked";

const SignalsContext = createContext(null);

/** `{sound, setSound, resume, testSound, notify, askNotify, testNotify}` for the settings screen.
 *  `sound`: "off" | "waiting" (wanted, no gesture yet) | "on" | "unsupported"; `notify`:
 *  "unsupported" | "insecure" | "default" | "granted" | "denied". */
export function useAlarmSignals() {
  const value = useContext(SignalsContext);
  if (!value) throw new Error("useAlarmSignals: no <AlarmSignals> above this component");
  return value;
}

function notifyState() {
  if (typeof window.Notification !== "function") return "unsupported";
  // Chrome refuses the Notification API on a plain-HTTP origin, silently: the old workspace learned
  // that on a ward visit and said so. So does this.
  if (window.isSecureContext === false) return "insecure";
  return window.Notification.permission;
}

/** An alarm's notification stays until someone dismisses it (`sticky`), as the old one did; the
 *  settings screen's test does not. */
function raise(title, body, sticky = true) {
  try {
    const notification = new window.Notification(title, { body, requireInteraction: sticky, vibrate: VIBRATE });
    navigator.vibrate?.(VIBRATE);
    return notification;
  } catch {
    // Some browsers refuse the constructor outright (Chrome on Android wants a service worker).
    return null;
  }
}

export function AlarmSignals({ children }) {
  const { t } = useI18n();
  const { phase, user } = useSession();
  const board = useBoard();
  const active = seesBoard(phase, user);
  const locked = phase === PHASE.LOCKED;

  const [audio, setAudio] = useState("suspended");
  const [engine] = useState(() => createAlarmSound({ onState: (state) => setAudio(state) }));
  const [wanted, setWanted] = useState(() => readPref(SOUND_PREF, SOUND_CHOICES, "off") === "on");
  const [permission, setPermission] = useState(notifyState);
  const [hidden, setHidden] = useState(() => document.hidden === true);
  const raised = useRef(new Map());

  useEffect(() => setAudio(engine.state()), [engine]);
  useEffect(() => () => engine.close(), [engine]);

  // Called from a click or a key press — a browser starts audio for nothing else.
  const resume = useCallback(() => {
    engine.resume().then(() => setAudio(engine.state()));
  }, [engine]);

  const setSound = useCallback((on) => {
    writePref(SOUND_PREF, on ? "on" : "off");
    setWanted(on);
    if (on) resume();
  }, [resume]);

  // Another tab of this browser changed the choice: follow it.
  useEffect(() => {
    const follow = (event) => {
      if (event.key !== null && event.key !== PREF_PREFIX + SOUND_PREF) return;
      setWanted(readPref(SOUND_PREF, SOUND_CHOICES, "off") === "on");
    };
    window.addEventListener("storage", follow);
    return () => window.removeEventListener("storage", follow);
  }, []);

  // A wanted sound waits for the first click or key press anywhere — the sign-in, the unlock.
  useEffect(() => {
    if (!wanted || audio !== "suspended") return undefined;
    for (const type of GESTURES) window.addEventListener(type, resume, true);
    return () => { for (const type of GESTURES) window.removeEventListener(type, resume, true); };
  }, [wanted, audio, resume]);

  // The sound: the worst waiting pattern while this session may see the board, nothing otherwise.
  const pattern = active && wanted ? soundFor(board) : null;
  useEffect(() => {
    if (pattern && audio === "running") engine.play(pattern);
    else engine.stop();
  }, [pattern, audio, engine]);

  useEffect(() => {
    const follow = () => setHidden(document.hidden === true);
    document.addEventListener("visibilitychange", follow);
    return () => document.removeEventListener("visibilitychange", follow);
  }, []);

  // The notifications. Keyed by alarm id — or LOCKED, the one raised while locked.
  const { alerts, connection } = board;
  useEffect(() => {
    const open = raised.current;
    const close = (key) => { open.get(key)?.close?.(); open.delete(key); };
    if (!active || permission !== "granted") {
      for (const key of [...open.keys()]) close(key);
      return;
    }
    const { known, items } = notifyFor({ alerts, connection });
    const keys = locked ? (items.length ? [LOCKED] : []) : items.map((a) => a.id);
    for (const key of [...open.keys()]) {
      const lockChanged = locked !== (key === LOCKED);
      // Only a LIVE board may say an alarm stopped waiting; a lock or an unlock retires the other kind.
      if (lockChanged || (known && !keys.includes(key))) close(key);
    }
    if (!hidden) return;
    if (locked) {
      if (keys.length && !open.has(LOCKED)) open.set(LOCKED, raise(t("signals.notifyTitle"), t("signals.notifyBodyLocked")));
      return;
    }
    for (const alarm of items) {
      if (open.has(alarm.id)) continue;
      open.set(alarm.id, raise(t("signals.notifyTitle"), t("signals.notifyBody", { bed: alarm.bedLabel || "—" })));
    }
  }, [active, permission, alerts, connection, locked, hidden, t]);

  const askNotify = useCallback(async () => {
    if (notifyState() !== "default") {
      setPermission(notifyState());
      return;
    }
    try {
      setPermission(await window.Notification.requestPermission());
    } catch {
      setPermission(notifyState());
    }
  }, []);

  const testNotify = useCallback(() => {
    if (notifyState() === "granted") raise(t("signals.testTitle"), t("signals.testBody"), false);
  }, [t]);

  const sound = !wanted ? "off" : audio === "running" ? "on" : audio === "unsupported" ? "unsupported" : "waiting";
  const value = { sound, setSound, resume, testSound: () => engine.test(), notify: permission, askNotify, testNotify };

  return (
    <SignalsContext.Provider value={value}>
      {children}
      {active && sound === "waiting" ? (
        <div className="fixed bottom-[22px] left-[22px] z-[210]">
          <Button variant="primary" icon="bell" onClick={resume}>{t("signals.soundWaiting")}</Button>
        </div>
      ) : null}
    </SignalsContext.Provider>
  );
}
```

Edit `dashboard/src/live/session/mount.testutil.jsx`. Replace:
```jsx
import { createBoardStore } from "../data/boardStore.js";
import { fakeApi, profile, token } from "./testTokens.testutil.js";
```
with:
```jsx
import { createBoardStore } from "../data/boardStore.js";
import { AlarmSignals } from "../signals/AlarmSignals.jsx";
import { fakeApi, profile, token } from "./testTokens.testutil.js";
```

Edit `dashboard/src/live/session/mount.testutil.jsx`. Replace:
```jsx
  render(
    <I18nProvider><ToastProvider>
      <SessionProvider store={store}><BoardProvider store={board}>{ui}</BoardProvider></SessionProvider>
    </ToastProvider></I18nProvider>,
  );
```
with:
```jsx
  render(
    <I18nProvider><ToastProvider>
      <SessionProvider store={store}><BoardProvider store={board}>
        <AlarmSignals>{ui}</AlarmSignals>
      </BoardProvider></SessionProvider>
    </ToastProvider></I18nProvider>,
  );
```

- [ ] **Step 8: Run what it touches**

```bash
cd /c/tmp/g116-impl/dashboard
npx vitest run src/live/signals/ src/live/LiveApp.test.jsx src/reachable.test.js src/live/i18n/ src/live/rawKeys.test.jsx 2>&1 | grep -E "Test Files|Tests "
```
Expected: every file passes. The rule has 8 tests, the engine 9, the provider 14, `LiveApp.test.jsx` 36 (was 35), `reachable.test.js` 3, `rawKeys.test.jsx` 5 and `strings.test.js` 6. The static key net (`rawKeys.test.jsx`) checks every `t("signals.…")` the provider names exists in four languages.

**Measured, and worth knowing before you change anything here:** these tests were mutated against the provider while it was written. Making a lock silence the sound fails 2 provider tests and the LiveApp one. Making the session's end leave it playing fails 2. Removing the gesture listener fails 7. Letting a lock keep a bed-naming notification failed **none** at first: on a LIVE board the other branch closes it anyway. So the lock test runs over a **dropped** stream, where only the lock can close it, and that mutation now fails 1. Do not "simplify" that `stream.drop()` away.

- [ ] **Step 9: Gate**

```bash
cd /c/tmp/g116-impl/dashboard
npx vitest run 2>&1 | tail -5
npx vitest run src/live/ 2>&1 | grep -E "Test Files|Tests "
```
Expected: `Test Files  92 passed (92)`, `Tests  2311 passed (2311)`: +3 / +32 (rule 8, engine 9, provider 14, LiveApp +1). Then `src/live/` alone: `65` / `1536`.

```bash
cd /c/tmp/g116-impl/dashboard
npx vite build 2>&1 | grep -E "\.js |built in|precache|larger than"
```
Expected, measured at `126a011`: `index-…js 147.58 kB │ gzip: 48.32 kB` (unchanged), `LiveApp-…js 166.00 kB │ gzip: 48.56 kB`, `Toast-…js 179.91 kB │ gzip: 66.04 kB` (the strings ride with the shared i18n chunk), `legacyRoots` 511.81 kB with its warning (until Task 6), `precache  22 entries`.

- [ ] **Step 10: Commit**

```bash
cd /c/tmp/g116-impl
git add dashboard/src/live/signals/fakeAudio.testutil.js dashboard/src/live/signals/signals.js dashboard/src/live/signals/signals.test.js dashboard/src/live/signals/alarmSound.js dashboard/src/live/signals/alarmSound.test.js dashboard/src/live/signals/AlarmSignals.jsx dashboard/src/live/signals/AlarmSignals.test.jsx dashboard/src/live/i18n/strings/signals.js dashboard/src/live/i18n/catalog.js dashboard/src/live/session/sessionStore.js dashboard/src/live/LiveApp.jsx dashboard/src/live/session/mount.testutil.jsx dashboard/src/live/LiveApp.test.jsx
git status --short
git commit -m "$(cat <<'EOF'
feat(dashboard): the alarm sound and the critical-alarm notification, ported into the live UI

G1-16, Task 4, before the old workspace that carried them is deleted (the user's decision). The
same IEC 60601-1-8 patterns (clinicalAudio.js's numbers), the same rule — the worst alarm nobody
has answered, as the board store's own waiting queue says — in one tested mapping (signals.js);
a notification per critical alarm while the page is in the background, as before. New, because
the old workspace had no lock screen: the sound goes on through a lock, a locked PC's
notification names no bed, and the end of the session stops the sound and closes them all.
The choice is kept per browser and waits, visibly, for the click a browser needs to start audio.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```
`git status --short` must show 8 `A` lines and 5 `M` lines.

**Gate:** 92 / 2311 (+3 / +32); `src/live/` 65 / 1536; `reachable.test.js` 3 green; build as above, 22 precache entries.

---

### Task 5: The opt-in, in Settings

**Files:** Modify `dashboard/src/live/i18n/strings/signals.js`, `dashboard/src/live/screens/settings/SettingsScreen.jsx`, `dashboard/src/live/screens/settings/SettingsScreen.test.jsx`.

The old build had two top-bar buttons (sound, notifications), a test-notification button, and a banner asking for permission. Here they are **this browser's settings**, in a fourth tab beside appearance, profile and security. Each state is said rather than coloured: off; waiting for a click; ready; not in this browser; permission default, granted, blocked, or unavailable on a non-HTTPS page. The test sound plays one critical burst and nothing after it: it is how G1-15 checks a real speaker without a real alarm. The banner is not ported; its "even when the tab is closed" was untrue (Decision 22).

- [ ] **Step 1: The texts.** Four replacements in `dashboard/src/live/i18n/strings/signals.js`, one per language.

Edit `dashboard/src/live/i18n/strings/signals.js`. Replace:
```js
    soundWaiting: "Alarm sesi beklemede — açmak için tıklayın",
  },
  az: {
```
with:
```js
    soundWaiting: "Alarm sesi beklemede — açmak için tıklayın",
    // Settings › Ses ve bildirim
    tab: "Ses ve bildirim",
    sound: "Alarm sesi",
    soundOff: "Kapalı",
    soundOn: "Açık",
    soundHelp: "Yanıt bekleyen bir alarm varken bu bilgisayarda çalar: kritik alarmda sık ve hızlı, yüksek ve orta alarmda daha seyrek (IEC 60601-1-8 düzeni). Alarm onaylanınca susar. Ekran kilitliyken de çalar; oturum kapanınca durur. Seçim bu tarayıcıda saklanır.",
    soundStateRunning: "Hazır",
    soundStateWaiting: "Bir tıklama bekliyor",
    soundStateUnsupported: "Bu tarayıcıda yok",
    soundWaitingHelp: "Tarayıcılar sesi ancak sayfaya bir tıklama ya da tuş vuruşundan sonra açar. Sayfa yeniden yüklendiyse (örneğin bilgisayar ya da tarayıcı yeniden başladıysa) biri sayfaya dokunana kadar ses çıkmaz.",
    soundUnsupported: "Bu tarayıcı ses çalamıyor (Web Audio yok); alarmlar yalnız ekranda görünür.",
    soundTest: "Sesi dene",
    notify: "Kritik alarm bildirimi",
    notifyHelp: "Bu sayfa arka plandayken — başka bir pencere ya da sekme öndeyken — yanıt bekleyen her yeni kritik alarm için işletim sisteminin bildirimini gösterir. Sayfa kapalıysa bildirim gelmez. Ekran kilitliyken bildirim yatak adı taşımaz.",
    notifyAsk: "İzin ver",
    notifyStateGranted: "İzin verildi",
    notifyStateDefault: "İzin verilmedi",
    notifyStateDenied: "Engellendi",
    notifyStateUnavailable: "Kullanılamaz",
    notifyDenied: "Tarayıcı bildirimleri engelledi; tarayıcının site ayarlarından açılır.",
    notifyInsecure: "Tarayıcı bildirimleri yalnız güvenli (HTTPS) adreste çalışır.",
    notifyUnsupported: "Bu tarayıcı bildirim gösteremiyor.",
    notifyTest: "Bildirimi dene",
  },
  az: {
```

Edit `dashboard/src/live/i18n/strings/signals.js`. Replace:
```js
    soundWaiting: "Siqnal səsi gözləmədədir — açmaq üçün klikləyin",
  },
```
with:
```js
    soundWaiting: "Siqnal səsi gözləmədədir — açmaq üçün klikləyin",
    tab: "Səs və bildiriş",
    sound: "Siqnal səsi",
    soundOff: "Bağlı",
    soundOn: "Açıq",
    soundHelp: "Cavab gözləyən siqnal olanda bu kompüterdə çalınır: kritik siqnalda tez-tez və sürətlə, yüksək və orta siqnalda daha seyrək (IEC 60601-1-8 qaydası). Siqnal təsdiqlənəndə susur. Ekran kilidli olanda da çalınır; sessiya bağlananda dayanır. Seçim bu brauzerdə saxlanılır.",
    soundStateRunning: "Hazırdır",
    soundStateWaiting: "Bir klik gözləyir",
    soundStateUnsupported: "Bu brauzerdə yoxdur",
    soundWaitingHelp: "Brauzerlər səsi yalnız səhifəyə bir klik və ya düymə basılmasından sonra açır. Səhifə yenidən yüklənibsə (məsələn, kompüter və ya brauzer yenidən başladılıbsa), kimsə səhifəyə toxunana qədər səs çıxmır.",
    soundUnsupported: "Bu brauzer səs çala bilmir (Web Audio yoxdur); siqnallar yalnız ekranda görünür.",
    soundTest: "Səsi yoxla",
    notify: "Kritik siqnal bildirişi",
    notifyHelp: "Bu səhifə arxa planda olanda — başqa pəncərə və ya tab öndə olanda — cavab gözləyən hər yeni kritik siqnal üçün əməliyyat sisteminin bildirişini göstərir. Səhifə bağlıdırsa, bildiriş gəlmir. Ekran kilidli olanda bildirişdə çarpayının adı olmur.",
    notifyAsk: "İcazə ver",
    notifyStateGranted: "İcazə verilib",
    notifyStateDefault: "İcazə verilməyib",
    notifyStateDenied: "Bloklanıb",
    notifyStateUnavailable: "İstifadə olunmur",
    notifyDenied: "Brauzer bildirişləri bloklayıb; brauzerin sayt ayarlarından açılır.",
    notifyInsecure: "Brauzer bildirişləri yalnız təhlükəsiz (HTTPS) ünvanda işləyir.",
    notifyUnsupported: "Bu brauzer bildiriş göstərə bilmir.",
    notifyTest: "Bildirişi yoxla",
  },
```

Edit `dashboard/src/live/i18n/strings/signals.js`. Replace:
```js
    soundWaiting: "Звук тревоги ожидает — нажмите, чтобы включить",
  },
```
with:
```js
    soundWaiting: "Звук тревоги ожидает — нажмите, чтобы включить",
    tab: "Звук и уведомления",
    sound: "Звук тревоги",
    soundOff: "Выкл.",
    soundOn: "Вкл.",
    soundHelp: "Звучит на этом компьютере, пока есть тревога, ожидающая ответа: при критической — часто и быстро, при высокой и средней — реже (схема IEC 60601-1-8). Смолкает, когда тревогу подтвердили. Звучит и при заблокированном экране; останавливается, когда сеанс завершён. Выбор хранится в этом браузере.",
    soundStateRunning: "Готов",
    soundStateWaiting: "Ждёт щелчка",
    soundStateUnsupported: "В этом браузере нет",
    soundWaitingHelp: "Браузеры включают звук только после щелчка или нажатия клавиши на странице. Если страница перезагрузилась (например, после перезапуска компьютера или браузера), звука не будет, пока кто-нибудь не коснётся страницы.",
    soundUnsupported: "Этот браузер не умеет воспроизводить звук (нет Web Audio); тревоги видны только на экране.",
    soundTest: "Проверить звук",
    notify: "Уведомление о критической тревоге",
    notifyHelp: "Пока эта страница в фоне — когда впереди другое окно или вкладка, — показывает уведомление операционной системы о каждой новой критической тревоге, ожидающей ответа. Если страница закрыта, уведомлений нет. При заблокированном экране уведомление не называет койку.",
    notifyAsk: "Разрешить",
    notifyStateGranted: "Разрешено",
    notifyStateDefault: "Не разрешено",
    notifyStateDenied: "Заблокировано",
    notifyStateUnavailable: "Недоступно",
    notifyDenied: "Браузер заблокировал уведомления; они включаются в настройках сайта в браузере.",
    notifyInsecure: "Уведомления браузера работают только по защищённому адресу (HTTPS).",
    notifyUnsupported: "Этот браузер не умеет показывать уведомления.",
    notifyTest: "Проверить уведомление",
  },
```

Edit `dashboard/src/live/i18n/strings/signals.js`. Replace:
```js
    soundWaiting: "Alarm sound is waiting — click to turn it on",
  },
```
with:
```js
    soundWaiting: "Alarm sound is waiting — click to turn it on",
    tab: "Sound and notifications",
    sound: "Alarm sound",
    soundOff: "Off",
    soundOn: "On",
    soundHelp: "Plays on this computer while an alarm is awaiting a response: often and fast for a critical alarm, sparser for a high or moderate one (the IEC 60601-1-8 pattern). It stops when the alarm is acknowledged. It plays while the screen is locked too, and stops when the session ends. The choice is kept in this browser.",
    soundStateRunning: "Ready",
    soundStateWaiting: "Waiting for a click",
    soundStateUnsupported: "Not in this browser",
    soundWaitingHelp: "Browsers start sound only after a click or a key press on the page. If the page has reloaded (after the computer or the browser restarted, for instance), no sound plays until someone touches the page.",
    soundUnsupported: "This browser cannot play sound (no Web Audio); alarms are shown on screen only.",
    soundTest: "Test the sound",
    notify: "Critical alarm notification",
    notifyHelp: "While this page is in the background — another window or tab in front — it shows an operating-system notification for each new critical alarm awaiting a response. If the page is closed, no notification comes. While the screen is locked, the notification names no bed.",
    notifyAsk: "Allow",
    notifyStateGranted: "Allowed",
    notifyStateDefault: "Not allowed",
    notifyStateDenied: "Blocked",
    notifyStateUnavailable: "Unavailable",
    notifyDenied: "The browser has blocked notifications; they are turned on in the browser's site settings.",
    notifyInsecure: "Browser notifications only work on a secure (HTTPS) address.",
    notifyUnsupported: "This browser cannot show notifications.",
    notifyTest: "Test the notification",
  },
```

- [ ] **Step 2: The tests first.** Edit `dashboard/src/live/screens/settings/SettingsScreen.test.jsx`. Replace:
```jsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { mount } from "../../session/mount.testutil.jsx";
import { profile, token } from "../../session/testTokens.testutil.js";
import { SettingsScreen } from "./SettingsScreen.jsx";
```
with:
```jsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { mount } from "../../session/mount.testutil.jsx";
import { profile, token } from "../../session/testTokens.testutil.js";
import { fakeAudio, fakeNotifications, onPage } from "../../signals/fakeAudio.testutil.js";
import { SettingsScreen } from "./SettingsScreen.jsx";
```

Edit `dashboard/src/live/screens/settings/SettingsScreen.test.jsx`. Replace:
```jsx
  it("changes the language of this browser from the appearance tab", async () => {
    await mount(<SettingsScreen />);
    fireEvent.click(screen.getByRole("button", { name: "English" }));
    expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute("lang", "en");
  });
});
```
with:
```jsx
  it("changes the language of this browser from the appearance tab", async () => {
    await mount(<SettingsScreen />);
    fireEvent.click(screen.getByRole("button", { name: "English" }));
    expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute("lang", "en");
  });
});

// The alarm sound and the critical-alarm notification (signals/AlarmSignals.jsx). The previous
// workspace had two top-bar buttons for them; here they are this browser's settings.
describe("SettingsScreen · sound and notifications", () => {
  let page = null;
  afterEach(() => {
    page?.undo();
    page = null;
  });
  const flush = () => act(() => new Promise((resolve) => { setTimeout(resolve, 0); }));
  const sound = () => screen.getByRole("group", { name: "Siqnal səsi" });

  it("turns the sound on for this browser — the click that does it starts the audio — and offers a test", async () => {
    const audio = fakeAudio();
    page = onPage({ AudioContext: audio.AudioContext });
    await mount(<SettingsScreen />);
    tab("Səs və bildiriş");
    expect(within(sound()).getByRole("button", { name: "Bağlı" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(sound()).getByRole("button", { name: "Açıq" }));
    await flush();
    expect(localStorage.getItem("hmc.alarmSound")).toBe("on");
    expect(screen.getByText("Hazırdır")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Səsi yoxla" }));
    expect(audio.pulses()).toEqual(Array(10).fill(960));
  });

  // A browser that has not let the audio start yet: what a ward PC shows after a reload nobody has
  // touched (here the tab's own click would start it, so the fake refuses).
  it("says a wanted sound is waiting for a click after a reload, and why", async () => {
    localStorage.setItem("hmc.alarmSound", "on");
    page = onPage({ AudioContext: fakeAudio({ refuse: true }).AudioContext });
    await mount(<SettingsScreen />);
    tab("Səs və bildiriş");
    expect(screen.getByText("Bir klik gözləyir")).toBeInTheDocument();
    expect(screen.getByText(/kimsə səhifəyə toxunana qədər səs çıxmır/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Siqnal səsi gözləmədədir — açmaq üçün klikləyin" })).toBeInTheDocument();
  });

  it("asks the browser for notifications only on a click, says what it answered, and offers a test", async () => {
    const notes = fakeNotifications("default");
    page = onPage({ Notification: notes.Notification });
    await mount(<SettingsScreen />);
    tab("Səs və bildiriş");
    expect(screen.getByText("İcazə verilməyib")).toBeInTheDocument();
    expect(notes.Notification.requestPermission).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "İcazə ver" }));
    await flush();
    expect(screen.getByText("İcazə verilib")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Bildirişi yoxla" }));
    expect(notes.shown.map((n) => [n.title, n.options.requireInteraction])).toEqual([["Homunculus · yoxlama", false]]);
  });

  it("says what is missing: no Web Audio, a permission the browser has blocked", async () => {
    page = onPage({ Notification: fakeNotifications("denied").Notification });
    await mount(<SettingsScreen />);
    tab("Səs və bildiriş");
    fireEvent.click(within(sound()).getByRole("button", { name: "Açıq" }));
    await flush();
    expect(screen.getByText(/Bu brauzer səs çala bilmir/)).toBeInTheDocument();
    expect(screen.getByText("Bloklanıb")).toBeInTheDocument();
    expect(screen.getByText(/Brauzer bildirişləri bloklayıb/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "İcazə ver" })).toBeNull();
  });
});
```

```bash
cd /c/tmp/g116-impl/dashboard
npx vitest run src/live/screens/settings/ 2>&1 | grep -E "×|Tests "
```
Expected: the four new tests fail (there is no "Səs və bildiriş" tab): `Tests  4 failed | 4 passed (8)`.

- [ ] **Step 3: The tab.** Edit `dashboard/src/live/screens/settings/SettingsScreen.jsx`. Replace:
```jsx
import { PasswordForm } from "../../auth/PasswordForm.jsx";
import { Box, KV, KVList, Note, Seg, StatusPill, TabPanel, Tabs, useToast } from "../../ui/index.js";
```
with:
```jsx
import { PasswordForm } from "../../auth/PasswordForm.jsx";
import { useAlarmSignals } from "../../signals/AlarmSignals.jsx";
import { Box, Button, KV, KVList, Note, Seg, StatusPill, TabPanel, Tabs, useToast } from "../../ui/index.js";
```

Edit `dashboard/src/live/screens/settings/SettingsScreen.jsx`. Replace:
```jsx
export function SettingsScreen() {
  const { t } = useI18n();
  const [tab, setTab] = useState("look");
  const tabs = [
    { value: "look", label: t("account.look") },
    { value: "profile", label: t("account.profile") },
    { value: "security", label: t("account.security") },
  ];
```
with:
```jsx
const SOUND_PILL = {
  off: ["neutral", "signals.soundOff"],
  waiting: ["att", "signals.soundStateWaiting"],
  on: ["ok", "signals.soundStateRunning"],
  unsupported: ["neutral", "signals.soundStateUnsupported"],
};
const NOTIFY_PILL = {
  granted: ["ok", "signals.notifyStateGranted"],
  default: ["neutral", "signals.notifyStateDefault"],
  denied: ["att", "signals.notifyStateDenied"],
  insecure: ["neutral", "signals.notifyStateUnavailable"],
  unsupported: ["neutral", "signals.notifyStateUnavailable"],
};
const NOTIFY_NOTE = {
  denied: "signals.notifyDenied",
  insecure: "signals.notifyInsecure",
  unsupported: "signals.notifyUnsupported",
};

/** The alarm sound and the critical-alarm notification for this browser (signals/AlarmSignals.jsx):
 *  what the previous workspace's two top-bar buttons did, with what each state means said out loud. */
function Signals() {
  const { t } = useI18n();
  const { sound, setSound, testSound, notify, askNotify, testNotify } = useAlarmSignals();
  const [soundTone, soundLabel] = SOUND_PILL[sound];
  const [notifyTone, notifyLabel] = NOTIFY_PILL[notify] ?? NOTIFY_PILL.unsupported;
  return (
    <div className="grid gap-3">
      <Box title={t("signals.sound")} icon="bell" level={2} right={<StatusPill tone={soundTone}>{t(soundLabel)}</StatusPill>}>
        <Seg label={t("signals.sound")} value={sound === "off" ? "off" : "on"} onChange={(value) => setSound(value === "on")}
          options={[{ value: "off", label: t("signals.soundOff") }, { value: "on", label: t("signals.soundOn") }]} />
        <p className="m-0 mt-2 text-13 text-mute">{t("signals.soundHelp")}</p>
        {sound === "waiting" ? <Note className="mt-2">{t("signals.soundWaitingHelp")}</Note> : null}
        {sound === "unsupported" ? <Note className="mt-2">{t("signals.soundUnsupported")}</Note> : null}
        {sound === "on" ? <Button className="mt-2" icon="bell" onClick={testSound}>{t("signals.soundTest")}</Button> : null}
      </Box>
      <Box title={t("signals.notify")} icon="alert" level={2} right={<StatusPill tone={notifyTone}>{t(notifyLabel)}</StatusPill>}>
        <p className="m-0 text-13 text-mute">{t("signals.notifyHelp")}</p>
        {NOTIFY_NOTE[notify] ? <Note className="mt-2">{t(NOTIFY_NOTE[notify])}</Note> : null}
        {notify === "default" ? <Button className="mt-2" variant="primary" onClick={askNotify}>{t("signals.notifyAsk")}</Button> : null}
        {notify === "granted" ? <Button className="mt-2" onClick={testNotify}>{t("signals.notifyTest")}</Button> : null}
      </Box>
    </div>
  );
}

export function SettingsScreen() {
  const { t } = useI18n();
  const [tab, setTab] = useState("look");
  const tabs = [
    { value: "look", label: t("account.look") },
    { value: "signals", label: t("signals.tab") },
    { value: "profile", label: t("account.profile") },
    { value: "security", label: t("account.security") },
  ];
```

Edit `dashboard/src/live/screens/settings/SettingsScreen.jsx`. Replace:
```jsx
        {tab === "look" ? <Look /> : tab === "profile" ? <Profile /> : <Security />}
```
with:
```jsx
        {tab === "look" ? <Look /> : tab === "signals" ? <Signals /> : tab === "profile" ? <Profile /> : <Security />}
```

```bash
cd /c/tmp/g116-impl/dashboard
npx vitest run src/live/screens/settings/ src/live/rawKeys.test.jsx src/live/i18n/ src/live/signals/ 2>&1 | grep -E "Test Files|Tests "
```
Expected: every file passes, `Tests  85 passed (85)`: Settings 8, `rawKeys.test.jsx` 5 (its sweep now opens the new tab too), the i18n tests and the three signals files. The waiting test uses a fake browser that **refuses** `resume()`: the click that opens the tab is a gesture, so with an obliging fake the "waiting" state is gone before the test can see it. That is also what happens on a real ward PC.

- [ ] **Step 4: Gate**

```bash
cd /c/tmp/g116-impl/dashboard
npx vitest run 2>&1 | tail -5
```
Expected: `Test Files  92 passed (92)`, `Tests  2315 passed (2315)` (+4). `src/live/`: 65 / 1540.

```bash
cd /c/tmp/g116-impl/dashboard
npx vite build 2>&1 | grep -E "\.js |built in|precache|larger than"
```
Expected, measured at `126a011`: `LiveApp-…js 168.03 kB │ gzip: 49.03 kB`, `Toast-…js 186.00 kB │ gzip: 68.41 kB`, the rest as Task 4, `precache  22 entries`.

- [ ] **Step 5: Look at it** (no browser driver here; the user's or G1-15's). Settings › "Səs və bildiriş" at 390 px and 1440 px in both themes. Turn the sound on and press "Səsi yoxla": a real speaker must sound the critical burst. Allow notifications and press "Bildirişi yoxla" with the page in front: the OS shows the test. Then reload: the floating "Siqnal səsi gözləmədədir…" button appears, and one click anywhere removes it. Recorded in the roadmap's G1-15 gate (Task 9).

- [ ] **Step 6: Commit**

```bash
cd /c/tmp/g116-impl
git add dashboard/src/live/i18n/strings/signals.js dashboard/src/live/screens/settings/SettingsScreen.jsx dashboard/src/live/screens/settings/SettingsScreen.test.jsx
git status --short
git commit -m "$(cat <<'EOF'
feat(dashboard): the alarm sound and the notification are this browser's settings

G1-16, Task 5. The old top bar's two buttons and its test-notification button, as a Settings tab
that says each state out loud — off, waiting for a click, ready, not in this browser; allowed,
not allowed, blocked, unavailable off HTTPS — with a one-burst sound test for a real speaker.
The old permission banner is not ported: it promised notifications "even when the tab is
closed", which no build can deliver.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

**Gate:** 92 / 2315 (+4); Settings 8; build as above.

---

### Task 6: The simulation and the previous workspace

**Files:**
- Replace whole: `dashboard/src/routing.test.js`, `dashboard/src/main.jsx`
- Modify (comments only): `dashboard/src/LoadFailed.jsx`, `dashboard/src/live/apiErrors.test.js`, `dashboard/src/live/boundaries.test.js`, `dashboard/src/live/i18n/I18nProvider.test.jsx`, `dashboard/src/live/i18n/strings.test.js`, `dashboard/src/live/screens/admin/catalogue.js`, `dashboard/src/live/screens/common/feedHealth.js`, `dashboard/src/live/theme/ThemeProvider.jsx`, `dashboard/src/live/theme/ThemeProvider.test.jsx`
- Delete (`git rm`), 31 files: `dashboard/src/{legacyRoots.jsx,legacyRoots.test.jsx,ClinicalDemo.jsx,ClinicalDemo.rbac.test.jsx,clinicalDemo.js,clinicalDemo.test.js,liveStore.js,liveStore.test.js,liveStore.live.test.js,liveStore.admin.test.js,auditFromEngine.test.js,clinicalCharting.test.js,scopeAssignment.test.js,clinicalI18n.js,i18n.rbac.test.js,clinicalTheme.js,clinicalAudio.js,ui.jsx,ui.test.jsx,liveAdmin.js,liveAdmin.test.js,permissions.js,permissions.test.js,nav.test.js,DemoDataBanner.jsx,DemoDataBanner.test.jsx}` and `dashboard/src/admin/{GroupAdmin.jsx,GroupAdmin.test.jsx,LiveStaffTab.jsx,LiveUserAdmin.jsx,LiveUserAdmin.test.jsx}`

This is the task that closes the roadmap's "`?eski=1` does not know the lock screen; it must go before G1-15".

- [ ] **Step 1: The tests first.** Write `dashboard/src/routing.test.js` whole:

```js
import { describe, it, expect, vi, afterEach } from "vitest";
import { createElement } from "react";
import { render, screen } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { importsOf, staticImportsOf } from "./live/imports.testutil.js";
import { chooseMode, withoutRetired, AppShell } from "./main.jsx";

/** An address as `window.location` carries it: `{pathname, search, hash}`. */
const at = (url) => new URL(url, "http://localhost:3000");

describe("chooseMode", () => {
  it("defaults to live — the address a clinician types is the real system", () => {
    expect(chooseMode(new URLSearchParams(""))).toBe("live");
  });

  it("still honours ?live=1 for anyone with an old link", () => {
    expect(chooseMode(new URLSearchParams("live=1"))).toBe("live");
  });

  // G1-16 removed every root that was not the live system. Their addresses are still in
  // bookmarks, in links in old messages and in the icon a tablet added to its home screen before
  // Wave 2 (whose start_url was /?demo=1): each opens what the bare URL opens — never a blank
  // page, and never a simulation.
  it.each(["demo=1", "eski=1", "mode=replay", "scenario=septic_shock", "board=1", "board=1&token=abc"])(
    "opens the live system on the retired ?%s", (query) => {
      expect(chooseMode(new URLSearchParams(query))).toBe("live");
    },
  );
});

describe("design gallery (?tasarim=1)", () => {
  it("opens the new UI's design gallery", () => {
    expect(chooseMode(new URLSearchParams("tasarim=1"))).toBe("tasarim");
  });

  it("never wins over an explicit ?live=1", () => {
    expect(chooseMode(new URLSearchParams("tasarim=1&live=1"))).toBe("live");
  });
});

describe("the address an old bookmark is left with", () => {
  // The page it opens is the live system, so the address must stop saying otherwise: a bar that
  // reads ?demo=1 above real patients is a claim, and ?board=1&token=… kept a tenant token in the
  // address, the history and every bookmark made from it.
  it("is not rewritten when it carries nothing retired", () => {
    for (const url of ["/", "/?live=1", "/?tasarim=1", "/#/alarms", "/?mode=kiosk", "/#/demographics"]) {
      expect(withoutRetired(at(url)), url).toBeNull();
    }
  });

  it("loses the simulation's parameter", () => {
    expect(withoutRetired(at("/?demo=1"))).toBe("/");
  });

  it("loses the previous workspace's", () => {
    expect(withoutRetired(at("/?eski=1"))).toBe("/");
  });

  it("loses the legacy board's parameter, and the tenant token it carried", () => {
    expect(withoutRetired(at("/?board=1&token=abc"))).toBe("/");
    expect(withoutRetired(at("/?token=abc"))).toBe("/");
  });

  it("loses the replay's", () => {
    expect(withoutRetired(at("/?mode=replay&scenario=nec"))).toBe("/");
    expect(withoutRetired(at("/?scenario=nec"))).toBe("/");
  });

  it("loses the simulation's oldest link, #/demo", () => {
    expect(withoutRetired(at("/#/demo"))).toBe("/");
    expect(withoutRetired(at("/?live=1#/demo/beds"))).toBe("/?live=1");
  });

  it("keeps everything else, the path and the deep link included", () => {
    expect(withoutRetired(at("/panel/?board=1&live=1#/alarms"))).toBe("/panel/?live=1#/alarms");
  });
});

describe("the page as it loads", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState(null, "", "/");
  });

  // main.jsx does this once, at load, before anything renders: LiveApp keeps `location.search`
  // whenever it clears the hash, so a retired parameter left in the bar would stay there for the
  // whole session.
  it("rewrites an old bookmark's address before anything renders", async () => {
    window.history.replaceState(null, "", "/?board=1&token=abc#/alarms");
    vi.resetModules();
    await import("./main.jsx");
    expect(window.location.search).toBe("");
    expect(window.location.hash).toBe("#/alarms");
  });

  it("leaves an address with nothing retired untouched — a reload keeps its place", async () => {
    window.history.replaceState(null, "", "/?live=1#/patients/P-1");
    const replace = vi.spyOn(window.history, "replaceState");
    vi.resetModules();
    await import("./main.jsx");
    expect(replace).not.toHaveBeenCalled();
    expect(window.location.hash).toBe("#/patients/P-1");
  });
});

describe("AppShell", () => {
  // jsdom does no layout, so this pins the structure instead of measuring it. The frame is one
  // screen tall with overflow hidden: if the app's wrapper did not scroll, everything below the
  // first screen (a bed below the fold) would be unreachable. Measured in Chrome at 1366x768
  // before the fix: 3032 px of board in a 672 px window, no scrollbar anywhere.
  it("lets the app scroll inside the one-screen frame", () => {
    render(createElement(AppShell, null, createElement("p", null, "uygulama")));
    const wrapper = screen.getByText("uygulama").parentElement;
    expect(wrapper.className.split(/\s+/)).toEqual(
      expect.arrayContaining(["min-h-0", "flex-1", "overflow-y-auto"]));
    expect(wrapper.parentElement.className).toContain("overflow-hidden");
  });

  it("draws the app and nothing else: no demonstration banner is left to draw", () => {
    const { container } = render(createElement(AppShell, null, "x"));
    expect(container.firstChild.children).toHaveLength(1);
  });
});

describe("what the page downloads", () => {
  const MAIN = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "main.jsx"), "utf8");
  // The same reader boundaries.test.js and reachable.test.js use, so a multi-line import, a
  // re-export or a bare `import "x"` cannot slip past this check either.
  const all = importsOf(MAIN);
  const statics = staticImportsOf(MAIN);
  const lazily = all.specs.filter((spec) => !statics.includes(spec));

  it("reads every import main.jsx makes", () => {
    expect(all.unreadable).toEqual([]);
  });

  // Whatever main.jsx imports statically is in the first chunk, which every page load fetches
  // before it can show even "the page could not be loaded". Adding to it is a decision, not a
  // side effect of an import line: this list is where that decision is made.
  it("puts only React, the load boundary and the page's own stylesheet and font in the first chunk", () => {
    expect(statics).toEqual(["@fontsource-variable/figtree", "./index.css", "react", "react-dom/client", "./LoadFailed.jsx"]);
  });

  it("reaches the live UI and the design gallery lazily, and nothing else", () => {
    expect([...lazily].sort()).toEqual(["./live/LiveApp.jsx", "./live/gallery/DesignGallery.jsx"]);
  });
});
```

- [ ] **Step 2: Watch it fail**

```bash
cd /c/tmp/g116-impl/dashboard
npx vitest run src/routing.test.js 2>&1 | grep -E "Tests "
```
Expected: `Tests  7 failed | 17 passed (24)`. The seven: `?demo=1` and `?eski=1` still open their roots; the demo, previous-workspace and `#/demo` cases of `withoutRetired`; and both "what the page downloads" pins (`legacyRoots.jsx` and `DemoDataBanner.jsx` are still imported).

- [ ] **Step 3: `main.jsx`, final.** Write `dashboard/src/main.jsx` whole:

```jsx
import "@fontsource-variable/figtree";
import "./index.css";
import React from "react";
import { createRoot } from "react-dom/client";
import { LoadBoundary } from "./LoadFailed.jsx";

/**
 * Which mode a URL selects. Exported so the routing is testable without a DOM.
 *
 * There is one product: the bare URL — the address a clinician naturally types — is the live
 * system, and so is every other address but the design gallery's. `?live=1` remains honoured for
 * old links and, being an explicit ask for the real system, wins over `?tasarim=1`.
 *
 * G1-16 removed every root that was not the live system: the simulation (`?demo=1`, `#/demo`), the
 * previous live workspace (`?eski=1`), the replay (`?mode=replay`, `?scenario=`) and the legacy
 * bearer-token board (`?board=1`). Their addresses open the live system, and `withoutRetired`
 * takes their parameters out of the address bar.
 */
export function chooseMode(params) {
  if (params.get("live") === "1") return "live";
  // The new UI's design review page (G1-05): no API, no patient data, linked from nowhere.
  if (params.get("tasarim") === "1") return "tasarim";
  return "live";
}

/** Parameters only a removed root read. `mode` is retired only as `mode=replay`: another value
 *  is not this page's to take away. */
const RETIRED_PARAMS = Object.freeze(["demo", "eski", "board", "token", "scenario"]);
/** The simulation's oldest entry, from before `?demo=1`: `#/demo` and anything under it. */
const RETIRED_HASH = /^#\/demo(?:[/?#]|$)/;

/**
 * The address an old bookmark is left with once the parameters of the roots G1-16 removed are
 * taken out — or null when it carries none, and must not be touched. Exported for its tests.
 *
 * Such an address opens the live system (chooseMode), so it must stop saying otherwise: a bar
 * reading `?demo=1` above real patients is a claim, and `?board=1&token=…` kept a tenant token in
 * the address, the history and every bookmark made from it. Everything else stays — the path, any
 * other parameter and the hash, which is a deep link the live UI uses once.
 */
export function withoutRetired({ pathname, search, hash }) {
  const query = new URLSearchParams(search);
  let changed = false;
  for (const key of RETIRED_PARAMS) {
    if (query.has(key)) {
      query.delete(key);
      changed = true;
    }
  }
  if (query.get("mode") === "replay") {
    query.delete("mode");
    changed = true;
  }
  let rest = hash;
  if (RETIRED_HASH.test(hash)) {
    rest = "";
    changed = true;
  }
  if (!changed) return null;
  const kept = query.toString();
  return `${pathname}${kept ? `?${kept}` : ""}${rest}`;
}

// Once, before anything renders: LiveApp keeps `location.search` whenever it clears the hash, so a
// retired parameter left here would stay in the bar for the whole session.
const cleaned = withoutRetired(window.location);
if (cleaned !== null) window.history.replaceState(window.history.state, "", cleaned);

function pickRoot(mode) {
  if (mode === "tasarim") {
    return <React.Suspense fallback={null}><DesignGallery /></React.Suspense>;
  }
  // The live system: the new shell (G1-07/G1-08), on the real API and nothing simulated.
  return <React.Suspense fallback={null}><LiveApp /></React.Suspense>;
}

// Lazy: the gallery and its fonts load only when ?tasarim=1 asks for them.
const DesignGallery = React.lazy(() => import("./live/gallery/DesignGallery.jsx"));
// Lazy too: the live UI, its fonts and tokens are not in the first chunk, so a page that cannot
// fetch them still has LoadFailed.jsx to say so.
const LiveApp = React.lazy(() => import("./live/LiveApp.jsx"));

const mode = chooseMode(new URLSearchParams(window.location.search));

/**
 * The page frame. Exported so its layout contract is testable.
 *
 * The frame is exactly one screen tall and hides its own overflow, so the page itself never
 * scrolls. The app's wrapper MUST therefore scroll (`overflow-y-auto`): without it everything
 * below the first screen — a bed below the fold, i.e. a patient — is unreachable (measured
 * 1366x768 on the previous workspace: 3032 px of content in 672 px).
 */
export function AppShell({ children }) {
  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}

const el = document.getElementById("root");
if (el) {
  // Every root is fetched on demand, and a fetch that fails throws during render: without the
  // boundary a ward PC with no network — or a tablet still holding a service worker from before a
  // deploy — showed a blank white page (LoadFailed.jsx).
  createRoot(el).render(
    <AppShell><LoadBoundary>{pickRoot(mode)}</LoadBoundary></AppShell>,
  );
}
```
The old `#/demo` branch (`hash.startsWith("#/demo") ? "demo"`) is gone. It used to win even over `?live=1`. Its hash is now removed by `RETIRED_HASH`, and `LiveApp` would anyway have treated `/demo` as no route and sent the session home (`resumePath`).

- [ ] **Step 4: Delete the simulation and the previous workspace, and everything only they reached**

```bash
cd /c/tmp/g116-impl/dashboard
git rm -q src/legacyRoots.jsx src/legacyRoots.test.jsx src/ClinicalDemo.jsx src/ClinicalDemo.rbac.test.jsx src/clinicalDemo.js src/clinicalDemo.test.js src/liveStore.js src/liveStore.test.js src/liveStore.live.test.js src/liveStore.admin.test.js src/auditFromEngine.test.js src/clinicalCharting.test.js src/scopeAssignment.test.js src/clinicalI18n.js src/i18n.rbac.test.js src/clinicalTheme.js src/clinicalAudio.js src/ui.jsx src/ui.test.jsx src/admin/GroupAdmin.jsx src/admin/GroupAdmin.test.jsx src/admin/LiveStaffTab.jsx src/admin/LiveUserAdmin.jsx src/admin/LiveUserAdmin.test.jsx src/liveAdmin.js src/liveAdmin.test.js src/permissions.js src/permissions.test.js src/nav.test.js src/DemoDataBanner.jsx src/DemoDataBanner.test.jsx
ls src | grep -v "^live$"
npx vitest run src/routing.test.js src/reachable.test.js src/live/boundaries.test.js 2>&1 | grep -E "Test Files|Tests "
```
Expected: `src/` holds only `LoadFailed.jsx`, `LoadFailed.test.jsx`, `backendApi.admin.test.js`, `backendApi.js`, `backendApi.test.js`, `devProxy.test.js`, `index.css`, `liveAdapters.js`, `liveAdapters.test.js`, `liveAuth.js`, `liveAuth.test.js`, `liveConnection.js`, `liveConnection.test.js`, `main.jsx`, `reachable.test.js`, `routing.test.js`, `sepsisContext.test.js` and `setupTests.js` (and `live/`; `src/admin/` is gone). Then `Test Files  3 passed (3)`, `Tests  31 passed (31)` (24 + 3 + 4).

- [ ] **Step 5: The comments that became false.** Nine edits, comments only, each anchored on text that occurs once. Edit `dashboard/src/LoadFailed.jsx`. Replace:

```js
// Every root but the first is fetched on demand (main.jsx: the live shell, the design gallery, the
// previous workspace and the simulation). A tablet whose network has gone — or one that was
```
with:
```js
// Every root is fetched on demand (main.jsx: the live shell and the design gallery). A tablet
// whose network has gone — or one that was
```

Edit `dashboard/src/live/apiErrors.test.js`. Replace:
```js
// message added or changed on the server fails here until apiErrors.js maps it — the same
// guarantee i18n.rbac.test.js gives the old workspace.
```
with:
```js
// message added or changed on the server fails here until apiErrors.js maps it — the guarantee
// i18n.rbac.test.js gave the old workspace until G1-16 removed both.
```

Edit `dashboard/src/live/i18n/strings.test.js`. Replace:
```js
// Every key in all four languages, non-empty, with the Turkish source's placeholders — the same
// guarantee i18n.rbac.test.js gives the old workspace's rbac block.
```
with:
```js
// Every key in all four languages, non-empty, with the Turkish source's placeholders — the
// guarantee i18n.rbac.test.js gave the old workspace's rbac block until G1-16 removed both.
```

Edit `dashboard/src/live/i18n/I18nProvider.test.jsx`. Replace:
```js
// The D2 versions of the language cases that i18n.rbac.test.js pins for the old workspace
// ("the UI language a ward opens in"): those stay as they are until the old workspace is removed
// (G1-16); the new shell opens in Azerbaijani.
```
with:
```js
// The D2 versions of the language cases i18n.rbac.test.js pinned for the old workspace ("the UI
// language a ward opens in"), which G1-16 removed with it: the shell opens in Azerbaijani.
```
(Its test "is not changed by the old workspace's stored language" stays as it is: a pilot PC may still hold `homunculus-clang`, and the shell must still ignore it.)

Edit `dashboard/src/live/screens/admin/catalogue.js`. Replace:
```js
// It is a copy rather than an import of `src/permissions.js`: roadmap D1 keeps `src/live/` off the
// old workspace, which G1-16 deletes. The old file carries the simulation's role tables too,
// which have no meaning here.
```
with:
```js
// It was a copy rather than an import of `src/permissions.js`: roadmap D1 kept `src/live/` off the
// old workspace, which G1-16 deleted, that file with it. The old file carried the simulation's
// role tables too, which have no meaning here.
```

Edit `dashboard/src/live/screens/common/feedHealth.js`. Replace:
```js
// connected to a screen (the project's own named failure mode). It could not simply be imported:
// roadmap D1 keeps `src/live/` off the old workspace, which G1-16 deletes. So it is copied, with
// its reasoning, and this time a screen reads it.
```
with:
```js
// connected to a screen (the project's own named failure mode). It could not simply be imported:
// roadmap D1 kept `src/live/` off the old workspace, which G1-16 deleted, the original with it. So
// it was copied, with its reasoning, and this time a screen reads it.
```

Edit `dashboard/src/live/boundaries.test.js`. Replace:
```js
// Roadmap D1: the new shell does not rest on the demo. Nothing under src/live/ may import the old
// workspace — ClinicalDemo.jsx, clinicalDemo.js, liveStore.js (built over the simulation),
// clinicalI18n.js, ui.jsx… — so G1-16 can delete it without touching a line here. What it may use
// from outside is the framework-free client of the real API: listed below, nothing else.
// (Tests may read more — permissions.js for the catalogue — so test files are not checked.)
```
with:
```js
// Roadmap D1: the new shell does not rest on the demo. Nothing under src/live/ imported the old
// workspace — ClinicalDemo.jsx, clinicalDemo.js, liveStore.js (built over the simulation),
// clinicalI18n.js, ui.jsx… — so G1-16 deleted it without touching a line here. What it may use
// from outside is the framework-free client of the real API: listed below, nothing else.
// (Tests may read more — the engine's own sources, for one — so test files are not checked.)
```

Edit `dashboard/src/live/theme/ThemeProvider.jsx`. Replace:
```js
  // Record what <html> had before (usually nothing) and put it back on unmount: the old app may run
  // in the same tab (?eski=1, until G1-16) and must not keep the live UI's theme, and a page that
  // had set its own value keeps it.
```
with:
```js
  // Record what <html> had before (usually nothing) and put it back on unmount: nothing the live
  // UI wrote outlives it (the old app that once shared the tab went in G1-16), and a page that
  // had set its own value keeps it.
```

Edit `dashboard/src/live/theme/ThemeProvider.test.jsx`. Replace:
```js
  // The old app may run in the same tab (?eski=1, until G1-16): leaving the live UI must not
  // leave its theme on <html> — and a value the page had before is given back, not deleted.
```
with:
```js
  // Leaving the live UI must not leave its theme on <html> (the old app that once shared the tab
  // went in G1-16) — and a value the page had before is given back, not deleted.
```

Provenance comments that stay true are left alone (Decision 14): `live/data/boardStore.js:6`, `live/session/sessionStore.js:18`, `live/auth/SessionWait.jsx:3`, `live/screens/admin/rules.js:4`, `useAdminData.js:3`, `live/i18n/strings/{board,news2,errors}.js`. `liveAdapters.js` is Task 7's. `live/theme/tailwind.test.js` is Task 8's.

- [ ] **Step 6: Gate**

```bash
cd /c/tmp/g116-impl/dashboard
npx vitest run 2>&1 | tail -5
npx vitest run src/live/ 2>&1 | grep -E "Test Files|Tests "
```
Expected: `Test Files  75 passed (75)`, `Tests  1781 passed (1781)`: −17 / −534 (routing 24 → 24, rewritten). Then `src/live/` alone: `65` / `1540`, **unchanged since Task 5**: nothing in the new UI leaned on what this task deletes, the ported sound included.

```bash
cd /c/tmp/g116-impl/dashboard
npx vite build 2>&1 | grep -E "\.(js|css) |built in|precache|larger than"
ls dist/assets | grep -E "legacyRoots|browser" || echo "none"
```
Expected, measured at `126a011`: `index-…css 28.84 kB │ gzip: 6.77 kB` (was 62.32: Tailwind no longer sees the old classes), `DesignGallery-…js 8.61 kB`, `index-…js 146.74 kB │ gzip: 48.02 kB`, `Toast-…js 186.00 kB │ gzip: 68.41 kB`, `LiveApp-…js 205.17 kB │ gzip: 63.22 kB` (it absorbed the old shared `browser` chunk), `✓ built in …`, **no `(!) Some chunks are larger than 500 kB` line**, `precache  21 entries (76….… KiB)`, then `none`.

- [ ] **Step 7: Commit**

```bash
cd /c/tmp/g116-impl
git add dashboard/src/routing.test.js dashboard/src/main.jsx dashboard/src/LoadFailed.jsx dashboard/src/live/apiErrors.test.js dashboard/src/live/boundaries.test.js dashboard/src/live/i18n/I18nProvider.test.jsx dashboard/src/live/i18n/strings.test.js dashboard/src/live/screens/admin/catalogue.js dashboard/src/live/screens/common/feedHealth.js dashboard/src/live/theme/ThemeProvider.jsx dashboard/src/live/theme/ThemeProvider.test.jsx
git status --short
git commit -m "$(cat <<'EOF'
feat(dashboard): the simulation and the previous workspace are gone; the page is the live UI

G1-16, Task 6. ?demo=1, #/demo and ?eski=1 open the live system and leave the address bar
(withoutRetired); main.jsx renders the live UI or the design gallery and nothing else, and
routing.test.js pins what it imports statically and lazily. ?eski=1 did not know the lock screen:
a locked browser opened it signed in. Deleted with everything only they reached: legacyRoots,
ClinicalDemo, clinicalDemo, liveStore, clinicalI18n, liveAdmin, admin/, permissions, ui,
clinicalTheme, clinicalAudio (ported in Task 4), DemoDataBanner and 17 test files. src/live/ is
unchanged (65 files / 1540 tests); comments that had become false are corrected. The build has no
500 kB chunk.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```
`git status --short` must show 31 `D` lines and 11 `M` lines.

**Gate:** 75 / 1781 (−17 / −534); `src/live/` 65 / 1540; routing 24; no 500 kB warning; first chunk 146.74 / 48.02 kB; 21 precache entries.

---

### Task 7: The adapter's seconds-unit `ack.atSec`

**Files:** Modify `dashboard/src/liveAdapters.js` and `dashboard/src/liveAdapters.test.js`.

The adapter's comment kept `ack.atSec` "because `clinicalDemo.js` computes its time-to-acknowledge … until G1-16 deletes it", and warned that `elapsed(ack.atSec)` would show an age of about 56 years without an error. The reason is gone; the trap goes too. `ack` itself stays, because the board store's waiting predicate tests it (Decision 10).

- [ ] **Step 1: The test first.** Edit `dashboard/src/liveAdapters.test.js`. Replace:

```js
    expect(alert.status).toBe("ACKNOWLEDGED");
    expect(alert.ack.by).toBe("nurse");
    expect(alert.ack.atSec).toBe(Date.parse("2026-08-27T10:05:00Z") / 1000);
  });
```
with:
```js
    expect(alert.status).toBe("ACKNOWLEDGED");
    expect(alert.ack.by).toBe("nurse");
    // The instant is `ackAtMs`, in milliseconds. `ack` also carried it in SECONDS (`atSec`) for
    // the old workspace's time-to-acknowledge; `elapsed(ack.atSec)` would have aged it by about 56
    // years without an error. That workspace went in G1-16, and the second unit with it.
    expect(alert.ack).not.toHaveProperty("atSec");
    expect(alert.ackAtMs).toBe(Date.parse("2026-08-27T10:05:00Z"));
  });
```

```bash
cd /c/tmp/g116-impl/dashboard
npx vitest run src/liveAdapters.test.js 2>&1 | grep -E "→|Tests "
```
Expected: `→ expected { by: 'nurse', reason: null, …(2) } to not have property "atSec"`, `Tests  1 failed | 49 passed (50)`.

- [ ] **Step 2: The adapter.** Edit `dashboard/src/liveAdapters.js`. Replace:

```js
/** ISO-8601 -> epoch seconds, or null if absent/unparseable. Never fabricate a time. */
function secondsFromTimestamp(iso) {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms / 1000;
}

/** ISO-8601 -> epoch milliseconds, or null if absent/unparseable. */
```
with:
```js
/** ISO-8601 -> epoch milliseconds, or null if absent/unparseable. Never fabricate a time. */
```

Replace:
```js
        // WHO and WHEN, for a Wave-3 alarms row. **These two are the pair a new screen reads**;
        // `ack` below is the old workspace's own shape and carries the same instant in SECONDS.
        // Both are derived from the one value here so they cannot drift, but the units differ, and
        // `elapsed(ack.atSec)` would hand a clinician an age of about 56 years without erroring —
        // the instant is simply in the wrong unit, and nothing in a number's type says so. Prefer
        // `ackAtMs` everywhere new; `ack` goes with the workspace G1-16 deletes.
```
with:
```js
        // WHO and WHEN, for an alarms row. **These two are the pair a screen reads**, the instant
        // in milliseconds on the wall clock. `ack` below is a presence flag the board store tests
        // (`needsAnswer`); it no longer carries a time of its own (G1-16).
```

Replace:
```js
        // Only `by` and `atSec` are known: the backend does not persist a reason/note yet (Slice
        // 1's AckStore keeps only {by, at}). Inventing them would look like a clinician's own
        // words when they are not.
        //
        // The OLD workspace's shape, in SECONDS, kept because `clinicalDemo.js` computes its
        // time-to-acknowledge as `ack.atSec - firedAtSec` in three places and that code is live
        // until G1-16 deletes it. `atSec` is derived from the same instant as `ackAtMs` above
        // rather than parsed again, so the two can never state different times — only the same
        // time in two units. A new screen uses `ackBy` / `ackAtMs`.
        ack: a.acknowledged
          ? { by: a.acknowledged_by ?? null, reason: null, note: null,
              atSec: secondsFromTimestamp(a.acknowledged_at) }
          : null,
```
with:
```js
        // Only `by` is known: the backend does not persist a reason/note yet (Slice 1's AckStore
        // keeps only {by, at}). Inventing them would look like a clinician's own words when they
        // are not. Until G1-16 this also carried the instant in SECONDS (`atSec`) for the old
        // workspace's time-to-acknowledge — the same time in a second unit, which
        // `elapsed(ack.atSec)` would have read as about 56 years. The instant is `ackAtMs`.
        ack: a.acknowledged
          ? { by: a.acknowledged_by ?? null, reason: null, note: null }
          : null,
```

- [ ] **Step 3: Its other comments, which now point at deleted files.** Edit `dashboard/src/liveAdapters.js`. Replace:

```js
// Board/alert synthesis: BedBoard and AlarmPage were written against clinicalDemo.js's simulated
// `beds`/`alerts` shapes and stay that way (see ClinicalDemo.jsx's `BedBoard`/`AlertCard`). Rather
// than teach those components a second data language, these functions synthesize the SAME shapes
// from live patients, so live data renders through unmodified components.
```
with:
```js
// Board/alert synthesis. The shapes are the old workspace's: its BedBoard and AlarmPage were
// written against clinicalDemo.js's simulated `beds`/`alerts`, and these functions gave them the
// same shapes from live patients. That workspace went in G1-16 (it can be read at e4cdf15); the
// live board store reads `alertsFromPatients`, and the shapes are otherwise kept as they were.
```
Replace:
```js
// Engine severity (theme.js scale: info|low|moderate|high|critical) -> the TIER the alarm UI
// colors, sorts and gates snoozing by. Mirrors clinicalDemo.js's TIER_TO_SEV, inverted.
```
with:
```js
// Engine severity (info|low|moderate|high|critical) -> the TIER the old workspace's alarm UI
// coloured, sorted and gated snoozing by (clinicalDemo.js's TIER_TO_SEV, inverted). The live UI
// reads `severity`.
```
Replace:
```js
/** Flattens every patient's alerts into the flat list AlarmPage/AlertCard and the audio/push
 *  effects in ClinicalDemo.jsx read. `id` is "<patient_id>::<kind>" — a delimiter that cannot
 *  appear in a kind, so it round-trips through acknowledgeAlert unambiguously (see liveStore.js).
 *
 *  A real alarm's age is WALL-CLOCK time since the backend first saw it: `firstSeenAtMs` (epoch
 *  ms), null when the payload does not say — then the UI shows no age rather than an invented
 *  one. Nothing is put on the simulation's clock (`firedAtSec` is null): that clock runs at 60x
 *  and would age a real alarm a minute per second.
 *
 *  Escalation-chain fields (`currentStep`, `events`, `snooze`, `mutedUntil`) stay at their "just
 *  fired" defaults: escalation for live alerts happens server-side (the engine's own escalation
 *  loop). `source: "device"` marks that explicitly, so AlertCard shows none of the simulation's
 *  local escalation countdown, stages or chain for it. */
```
with:
```js
/** Flattens every patient's alerts into one flat list (the board store's `alerts`). `id` is
 *  "<patient_id>::<kind>" — a delimiter that cannot appear in a kind, so it round-trips
 *  unambiguously.
 *
 *  A real alarm's age is WALL-CLOCK time since the backend first saw it: `firstSeenAtMs` (epoch
 *  ms), null when the payload does not say — then the UI shows no age rather than an invented
 *  one. `firedAtSec` stays null: it was the old workspace's simulation clock, which ran at 60x and
 *  aged a real alarm a minute per second.
 *
 *  Escalation-chain fields (`currentStep`, `events`, `snooze`, `mutedUntil`) stay at their "just
 *  fired" defaults: escalation for live alerts happens server-side (the engine's own escalation
 *  loop). `source: "device"` marks that explicitly — the old workspace's AlertCard drew its own
 *  local escalation countdown for anything without it. */
```

Edit `dashboard/src/liveAdapters.test.js`. Replace:
```js
// bedsFromPatients / alertsFromPatients synthesize the simulation's `beds` and `alerts` shapes
// from live patients, so the existing BedBoard/AlarmPage components — written against the
// simulation — render real data without changing a line of component code.
```
with:
```js
// bedsFromPatients / alertsFromPatients synthesize the old workspace's `beds` and `alerts` shapes
// from live patients — its BedBoard/AlarmPage were written against the simulation. That workspace
// went in G1-16; the live board store reads alertsFromPatients.
```
Replace:
```js
      // What a list row shows: who, and when on the wall clock. `ack` keeps the shape the old
      // workspace's AlertCard reads; these two are what a new screen needs.
```
with:
```js
      // What a list row shows: who, and when on the wall clock. `ack` is the presence flag the
      // board store's waiting queue tests; these two are what a screen prints.
```
Replace:
```js
    // The local escalation countdown in AlertCard is computed from the SIMULATION's own
    // thresholds. Real alerts escalate server-side, on the backend's own timing, so the UI needs
    // a way to tell a real alert apart from a simulated one and suppress that local countdown.
```
with:
```js
    // The old workspace's AlertCard computed a local escalation countdown from the SIMULATION's
    // own thresholds. Real alerts escalate server-side, on the backend's own timing, so a real
    // alert says so rather than leave a screen to guess.
```

- [ ] **Step 4: Run what reads it**

```bash
cd /c/tmp/g116-impl/dashboard
npx vitest run src/liveAdapters.test.js src/live/data/ src/live/screens/alarms/ 2>&1 | grep -E "Test Files|Tests "
grep -rn "secondsFromTimestamp\|atSec:" src --include=*.js --include=*.jsx || echo "gone"
```
Expected: `Test Files  4 passed (4)`, `Tests  122 passed (122)`, then `gone`. Grep for the code forms only: a bare `atSec` still appears in the comments that say why it went, and in the test's own `not.toHaveProperty("atSec")`.

- [ ] **Step 5: Gate**

```bash
cd /c/tmp/g116-impl/dashboard
npx vitest run 2>&1 | tail -5
```
Expected: `Test Files  75 passed (75)`, `Tests  1781 passed (1781)`, unchanged.

```bash
cd /c/tmp/g116-impl/dashboard
npx vite build 2>&1 | grep -E "\.js |built in|precache|larger than"
```
Expected, measured at `126a011`: `LiveApp-…js 205.05 kB │ gzip: 63.20 kB` (−0.1 kB); everything else as Task 6; no warning; 21 entries.

- [ ] **Step 6: Commit**

```bash
cd /c/tmp/g116-impl
git add dashboard/src/liveAdapters.js dashboard/src/liveAdapters.test.js
git status --short
git commit -m "$(cat <<'EOF'
fix(dashboard): an acknowledgement carries its instant once, in milliseconds

G1-16, Task 7. alertsFromPatients kept ack.atSec — the same instant in SECONDS — only for the
old workspace's time-to-acknowledge, "until G1-16 deletes it"; elapsed(ack.atSec) would have
shown a 56-year age without an error. The field and its helper go; ack stays, as the presence
flag the board store's needsAnswer tests. Comments that named deleted files are corrected.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

**Gate:** 75 / 1781; liveAdapters 50; `LiveApp` 205.05 kB; no warning.

---

### Task 8: Leftovers: the precache, the old Tailwind palette, `index.html`

**Files:** Modify `dashboard/src/devProxy.test.js`, `dashboard/src/live/theme/tailwind.test.js`, `dashboard/tailwind.config.js` and `dashboard/vite.config.js`; write `dashboard/index.html` whole.

- [ ] **Step 1: The precache and `index.html` tests first.** Edit `dashboard/src/devProxy.test.js`. Replace:

```js
describe("what the service worker keeps offline", () => {
  // The simulation is not part of the product, and the service worker precached it: the
  // legacyRoots chunk and the five replay scenarios made a first visit to the REAL system cost
  // half a megabyte of a demonstration it never shows (31 entries / 1245 KiB, now 22 / 556 KiB).
  // They are still served when ?eski=1, ?demo=1 or ?mode=replay asks for them — just not kept.
  it("leaves the simulation's chunk and the replay scenarios out of the precache", () => {
    expect(VITE).toMatch(/globIgnores:\s*\[[^\]]*"\*\*\/legacyRoots-\*\.js"/);
    expect(VITE).toMatch(/globIgnores:\s*\[[^\]]*"demo\/\*\*"/);
    expect(VITE).not.toMatch(/includeAssets:\s*\[[^\]]*demo/);
  });
});
```
with:
```js
describe("what the service worker keeps offline", () => {
  // A ward PC's first visit downloads the precache. The design gallery (?tasarim=1) is a review
  // page with no data, linked from nowhere: it is served when someone types its address, and not
  // kept offline. The simulation's chunk and the replay scenarios were excluded the same way until
  // G1-16 removed them; a pattern for a file that no longer exists would only mislead.
  it("leaves the design gallery's chunk out of the precache, and names nothing that is gone", () => {
    expect(VITE).toMatch(/globIgnores:\s*\[\s*"\*\*\/DesignGallery-\*\.js"\s*\]/);
    expect(VITE).not.toMatch(/legacyRoots|demo\/\*\*|demo\/\*\.json/);
  });
});
```
Replace:
```js
    expect(VITE).not.toMatch(/description:\s*"[^"]*(demo|sentetik)/i);
  });
});
```
with:
```js
    expect(VITE).not.toMatch(/description:\s*"[^"]*(demo|sentetik)/i);
  });

  // index.html is what a browser shows before any chunk has loaded, and all it shows if the live
  // UI cannot load (LoadFailed.jsx). It said Turkish and carried the old app's `dark` class (a
  // Tailwind switch nothing in the live UI reads; it themes with data-theme).
  it("opens the page in the language the UI opens in, without the old app's dark class", () => {
    const html = fs.readFileSync(path.resolve(HERE, "../index.html"), "utf8");
    expect(html).toMatch(new RegExp(`<html lang="${DEFAULT_LANG}">`));
    expect(html).not.toMatch(/class="dark"/);
    expect(html).toMatch(/<title>Homunculus<\/title>/);
  });
});
```

- [ ] **Step 2: The Tailwind test.** Edit `dashboard/src/live/theme/tailwind.test.js`. Replace:

```js
// tailwind.config.js must reach every live token by class, and must not change a class the old
// app (ClinicalDemo and friends, removed in G1-16) already uses.
```
with:
```js
// tailwind.config.js must reach every live token by class, must not change one of Tailwind's own
// classes under a component's feet, and keeps nothing of the old app's (removed in G1-16) but the
// page's sans.
```
Replace:
```js
// Every key Tailwind ships in the sections this config extends. A key of the same name in
// `extend` would silently change a class the old app already uses (text-sm, rounded-lg, shadow-md,
// font-mono, bg-white…).
```
with:
```js
// Every key Tailwind ships in the sections this config extends. A key of the same name in
// `extend` would silently change one of Tailwind's own classes (text-sm, rounded-lg, shadow-md,
// font-mono, bg-white…) for every component that uses it.
```
Replace:
```js
// The one deliberate shadow: the old app's sans (Figtree first), which predates the live UI.
```
with:
```js
// The one deliberate shadow: the page's sans (Figtree first). index.css gives it to <body>, which
// is what LoadFailed.jsx is drawn in when the live UI's own stylesheet could not load.
```
Replace:
```js
  it("keeps the old app's brand, sev and sans exactly as they were", () => {
    expect(extend.colors.brand).toEqual({ DEFAULT: "#0891b2", 600: "#0891b2", 500: "#22d3ee" });
    expect(extend.colors.sev).toEqual({
      info: "#94a3b8", low: "#10b981", moderate: "#f59e0b", high: "#f97316", critical: "#ef4444",
    });
    expect(extend.fontFamily.sans).toEqual(["'Figtree Variable'", "system-ui", "sans-serif"]);
  });
```
with:
```js
  // The old app's palette (`brand`, `sev`) and its class-switched dark mode went with it (G1-16):
  // a `bg-sev-critical` written into a live component would otherwise still compile, to a colour
  // no theme controls. The sans stays — it is the page's, not the old app's.
  it("keeps the page's sans and nothing else of the old app's", () => {
    expect(extend.fontFamily.sans).toEqual(["'Figtree Variable'", "system-ui", "sans-serif"]);
    expect(extend.colors.brand).toBeUndefined();
    expect(extend.colors.sev).toBeUndefined();
    expect(config.darkMode).toBeUndefined();
  });
```
Replace:
```js
  it.each(Object.keys(DEFAULT_KEYS))("%s: no key shadows a Tailwind default (but the old app's sans)", (section) => {
```
with:
```js
  it.each(Object.keys(DEFAULT_KEYS))("%s: no key shadows a Tailwind default (but the page's sans)", (section) => {
```

- [ ] **Step 3: Watch them fail**

```bash
cd /c/tmp/g116-impl/dashboard
npx vitest run src/devProxy.test.js 2>&1 | grep -E "Tests "
npx vitest run src/live/theme/tailwind.test.js 2>&1 | grep -E "→|Tests "
```
Expected: `Tests  2 failed | 3 passed (5)` (the precache test, then the `index.html` test). Then `→ expected { '500': '#22d3ee', …(2) } to be undefined` and `Tests  1 failed | 11 passed (12)`.

- [ ] **Step 4: Confirm nothing still uses what goes**

```bash
cd /c/tmp/g116-impl/dashboard
grep -rnE "\bdark:|brand-|bg-sev|text-sev|border-sev" src index.html | grep -v "\.test\." || echo "unused"
```
Expected: `unused`.

- [ ] **Step 5: The config.** Edit `dashboard/tailwind.config.js`. Replace:

```js
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: "#0891b2", 600: "#0891b2", 500: "#22d3ee" },
        sev: { info: "#94a3b8", low: "#10b981", moderate: "#f59e0b", high: "#f97316", critical: "#ef4444" },
        // The live UI (src/live): one class per CSS variable in src/live/theme/tokens.css.
        ...tailwindColors(),
      },
      fontFamily: {
        sans: ["'Figtree Variable'", "system-ui", "sans-serif"],
```
with:
```js
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        // The live UI (src/live): one class per CSS variable in src/live/theme/tokens.css.
        ...tailwindColors(),
      },
      fontFamily: {
        // The page's own face (index.css's <body>, so LoadFailed.jsx too); the live UI uses the
        // three below.
        sans: ["'Figtree Variable'", "system-ui", "sans-serif"],
```

Write `dashboard/index.html` whole:
```html
<!doctype html>
<html lang="az">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#0891b2" />
    <title>Homunculus</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```

Edit `dashboard/vite.config.js`. Replace:
```js
      // SIMULATION, and the description said so while the app itself is the real one. The language
      // is the one the UI opens in (live/i18n/langs.js DEFAULT_LANG), not Turkish.
```
with:
```js
      // SIMULATION, and the description said so while the app itself is the real one. An icon
      // installed before then keeps opening "/?demo=1" until the browser re-reads this manifest;
      // since G1-16 that address opens the live system too (main.jsx, withoutRetired). The language
      // is the one the UI opens in (live/i18n/langs.js DEFAULT_LANG), not Turkish.
```
Replace:
```js
      // What a ward PC downloads on its first visit. The simulation is not part of the product:
      // its chunk (legacyRoots-*, ~529 kB) and the replay scenarios (demo/*.json) were precached
      // too, so opening the real system cost half a megabyte of a demonstration it never shows.
      // Both are still reachable — ?eski=1, ?demo=1 and ?mode=replay fetch them from the network
      // when someone deliberately asks — they are simply not kept offline.
      workbox: {
        globPatterns: ["**/*.{js,css,html,json,woff2,svg}"],
        globIgnores: ["**/legacyRoots-*.js", "demo/**"],
      },
```
with:
```js
      // What a ward PC downloads on its first visit: the live system and nothing else. The design
      // gallery (?tasarim=1) is a review page with no data, linked from nowhere — fetched from the
      // network when someone types its address, not kept offline. (The simulation's chunk and the
      // replay scenarios were excluded the same way until G1-16 removed them.)
      workbox: {
        globPatterns: ["**/*.{js,css,html,json,woff2,svg}"],
        globIgnores: ["**/DesignGallery-*.js"],
      },
```

- [ ] **Step 6: Run them**

```bash
cd /c/tmp/g116-impl/dashboard
npx vitest run src/devProxy.test.js src/live/theme/tailwind.test.js 2>&1 | grep -E "Test Files|Tests "
```
Expected: `Test Files  2 passed (2)`, `Tests  17 passed (17)` (5 + 12).

- [ ] **Step 7: Gate**

```bash
cd /c/tmp/g116-impl/dashboard
npx vitest run 2>&1 | tail -5
```
Expected: `Test Files  75 passed (75)`, `Tests  1782 passed (1782)` (+1).

```bash
cd /c/tmp/g116-impl/dashboard
npx vite build 2>&1 | grep -E "\.(js|css|html) |built in|precache|larger than"
grep -o 'url:"[^"]*"' dist/sw.js | grep -ciE "gallery|legacy|demo"
head -2 dist/index.html
```
Expected, measured: `index.html 0.57 kB`, the CSS and chunks as Task 7, no warning, **`precache  20 entries (75….… KiB)`**, then `0`, then `<!doctype html>` and `<html lang="az">`.

- [ ] **Step 8: Commit**

```bash
cd /c/tmp/g116-impl
git add dashboard/src/devProxy.test.js dashboard/src/live/theme/tailwind.test.js dashboard/tailwind.config.js dashboard/vite.config.js dashboard/index.html
git status --short
git commit -m "$(cat <<'EOF'
chore(dashboard): the precache holds the live system only; the old app's palette and dark switch go

G1-16, Task 8. The design gallery leaves the service worker's precache (20 entries); the globs
for the simulation's chunk and the replay scenarios named files that no longer exist.
tailwind.config.js loses darkMode "class" and the brand/sev palettes nothing uses any more, so a
sev colour in a live component cannot compile to a colour no theme controls. index.html opens in
the UI's language (az), without the old app's dark class.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

**Gate:** 75 / 1782 (+1); devProxy 5, tailwind 12; 20 precache entries; no warning.

---

### Task 9: The documents, and two engine comments

**Files:**
- Modify (comments only): `homunculus-engine/tests/test_nginx_routes.py`, `homunculus-engine/src/homunculus/admin/service.py`
- Modify: `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md`, `docs/homunculus-rehber-TR.md`, `docs/DEPLOY-SUPABASE.md`, `docs/EDGE-BRIDGE-LOCAL.md`, `docs/superpowers/specs/2026-09-23-ldap-rbac-design.md`
- Write whole: `docs/DEMO-DEPLOY.md`
- Outside the repo, not committed: `/c/tmp/homunculus-plans/amendments.md`, `/c/tmp/homunculus-plans/deferred.md`

**Before you start, collect the SHAs:**
```bash
git -C /c/tmp/g116-impl log --oneline feat/canli-tasarim..feat/g1-16 | cat
```
Expected: nine lines, newest first: Tasks 8, 7, 6, 5, 4, 3, 2, 1, then the plan commit (Task 0). Below, `<T1>` … `<T8>` mean the short SHA of that task's commit and `<gün.ay>` today's date as `13.10`. Replace every placeholder before you commit, then run `grep -n "<T[0-9]>\|<gün.ay>" <file>`; it must print nothing.

- [ ] **Step 1: The engine's two comments.** Edit `homunculus-engine/tests/test_nginx_routes.py`. Replace:

```python
    that answers in the API's shape — {"detail": "…"}, JSON in UTF-8 — which
    dashboard/src/clinicalI18n.js maps (i18n.rbac.test.js reads it from this file). Only nginx's
    own refusal: the API's 429s pass through as they are (no proxy_intercept_errors)."""
```
with:
```python
    that answers in the API's shape — {"detail": "…"}, JSON in UTF-8 — which
    dashboard/src/live/apiErrors.js maps (live/apiErrors.test.js reads it from this file). Only
    nginx's own refusal: the API's 429s pass through as they are (no proxy_intercept_errors)."""
```
Replace:
```python
    not "too many sign-in attempts" — in the API's shape ({"detail": "…"}, JSON in UTF-8, which
    dashboard/src/clinicalI18n.js maps; i18n.rbac.test.js reads it from this file), with
    `Retry-After: 60` as the sign-in's. Declared once, used by the two locations."""
```
with:
```python
    not "too many sign-in attempts" — in the API's shape ({"detail": "…"}, JSON in UTF-8, which
    dashboard/src/live/apiErrors.js maps; live/apiErrors.test.js reads it from this file), with
    `Retry-After: 60` as the sign-in's. Declared once, used by the two locations."""
```
Edit `homunculus-engine/src/homunculus/admin/service.py`. Replace:
```python
# it. The dashboard translates by this exact text (clinicalI18n.js): change both together.
```
with:
```python
# it. The dashboard translates by this exact text (dashboard/src/live/apiErrors.js): change both
# together.
```

```bash
cd /c/tmp/g116-impl/homunculus-engine
export PYTHONPATH="$PWD/src"
/c/tmp/f7-py312/venv/Scripts/python.exe -m py_compile src/homunculus/admin/service.py && echo compiled
timeout 300 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest tests/test_nginx_routes.py -q -p no:cacheprovider 2>&1 | tail -1
cd ../dashboard && npx vitest run src/live/apiErrors.test.js 2>&1 | grep -E "Tests "
grep -rn "clinicalI18n\|ClinicalDemo\|liveStore\|legacyRoots" ../homunculus-engine/src ../homunculus-engine/tests --include=*.py
```
Expected: `compiled`; `40 passed, 2 warnings in …s` (no database needed; never add `test_infinity_vm_pilot.py`); `Tests  137 passed (137)` (the dashboard reader of `service.py`); and the `grep` prints nothing.

- [ ] **Step 2: `docs/DEMO-DEPLOY.md`.** Write it whole:

```markdown
# The Homunculus demo (Vercel) — removed

The public demo was a static PWA that replayed pre-recorded engine output
(`dashboard/public/demo/*.json`) at `/?demo=1`, alongside the simulation it opened. Both were
removed from the dashboard in **G1-16** (roadmap
`docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md`, decision D1): the
dashboard is the live system only. Every address the demo used — `/?demo=1`, `/#/demo`,
`/?mode=replay`, `/?scenario=…` — now opens the live system's sign-in, and the parameter is taken
out of the address bar.

- The removed code and the recorded scenarios can be read at commit `e4cdf15`
  (`git show e4cdf15:dashboard/src/clinicalDemo.js`, `git show e4cdf15:dashboard/public/demo/septic_shock.json`).
- `homunculus-engine/scripts/record_demo.py` still exists and still writes those files when run;
  nothing in the dashboard reads them any more.
- **The Vercel project itself is not removed by any commit.** Taking the public deployment down
  — and the Render API behind it — is done in the Vercel and Render dashboards. Until then,
  `vercel.json`, `dashboard/.env.production` and `render.yaml` describe that deployment, and
  `docs/DEPLOY-SUPABASE.md` is its runbook.
```

- [ ] **Step 3: The roadmap.** Edit `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md`, sixteen replacements. Each old text occurs once.

**3a, D1 (line 55).** Replace:
```markdown
Vercel'deki genel demo da kalkar (yayından kaldırma kullanıcının işi) |
```
with:
```markdown
Vercel'deki genel demo da kalkar (yayından kaldırma kullanıcının işi). ✅ **G1-16 (`<T1>`…`<T8>`):** simülasyon, önceki canlı arayüz, replay ve eski pano koddan çıktı; eski adresleri canlı sistemi açar ve adres çubuğundan silinir. Vercel'deki yayın hâlâ kullanıcının işi |
```

**3b, the G1-16 row (line 117).** Replace:
```markdown
| G1-16 | Demo ve eski modları kaldır (`ClinicalDemo.jsx`, `clinicalDemo.js`, `liveStore.js`, `clinicalI18n.js`, `legacyRoots.jsx`, replay, legacy board, `?eski=1` önceki canlı arayüz — kilidi bilmez, G1-15'ten önce gitmeli); PWA `?demo` başlangıcı Dalga 2'de düzeltildi | 3 | Orta | G1-09…G1-14 | Bekliyor |
```
with:
```markdown
| G1-16 | Demo ve eski modları kaldır (`ClinicalDemo.jsx`, `clinicalDemo.js`, `liveStore.js`, `clinicalI18n.js`, `legacyRoots.jsx`, replay, legacy board, `?eski=1` önceki canlı arayüz — kilidi bilmez, G1-15'ten önce gitmeli); PWA `?demo` başlangıcı Dalga 2'de düzeltildi · plan: [G1-16](2026-10-13-g1-16-eski-modlari-kaldir.md) | 3 | Orta | G1-09…G1-14 | ✅ <gün.ay> · `<T1>`…`<T8>`. 80 dosya silindi (75 kaynak + 5 replay JSON'u, ~29 bin satır): sayfadan erişilemeyen 13 modül (`<T1>`; Grup 2–4 hedefleri, aşağıda "G1-16'da silinenler"), replay ve eski pano (`<T2>`), simülasyon ve önceki canlı arayüz (`<T6>`). `?demo=1`, `#/demo`, `?eski=1`, `?mode=replay`, `?scenario=`, `?board=1` canlı sistemi açar; parametre adresten silinir (`main.jsx` `withoutRetired`). `src/` altında sayfanın erişemediği modül kalmaz (`reachable.test.js`). Silmeden önce eski çalışma alanının **sesli alarmı ve arka plandaki kritik alarm bildirimi** yeni arayüze taşındı (`<T4>`, `<T5>`; kullanıcı kararı 13.10): kilitte de çalar, oturum bitince durur, ayarı Ayarlar › "Ses ve bildirim"de. Dashboard 75 dosya / 1782 test; 500 kB uyarısı yok; önbellek 20 kayıt |
```

**3c, the G1-15 gate's tablet item (lines 181–186).** Replace:
```markdown
- **(Dalga 2 incelemesi)** Tabletlerde ana ekrana eklenmiş uygulama **yeniden eklenir ya da yeniden
  kurulur.** PWA manifestinin `start_url`'ü Dalga 2'de `/?demo=1`'den `/`'ye çekildi, ama kurulu
  bir kısayol tarayıcı manifesti yeniden okuyana kadar eski adresi açmaya devam eder — yani
  simülasyonu. `?demo=1` G1-16'da silindiğinde o kısayol hiçbir şey açmaz (artık boş sayfa değil,
  "sayfa yüklenemedi" der — `src/LoadFailed.jsx`). Deploy'dan sonra her tablet tek tek gözden
  geçirilir.
```
with:
```markdown
- **(Dalga 2 incelemesi; G1-16'yla değişti)** Tabletlerde ana ekrana eklenmiş uygulama: PWA
  manifestinin `start_url`'ü Dalga 2'de `/?demo=1`'den `/`'ye çekildi, ama kurulu bir kısayol
  tarayıcı manifesti yeniden okuyana kadar eski adresi açar. **G1-16'dan beri o adres de canlı
  sistemi açar** — `?demo=1` adresten silinir (`main.jsx` `withoutRetired`); simülasyon da yok,
  "sayfa yüklenemedi" de. Yeniden eklemek artık doğruluk için gerekmiyor: eski kurulumda kalan
  yalnız eski manifestin adı, açıklaması ve dilidir, tarayıcı manifesti yeniden okuyunca düzelir.
  Tabletleri yine de tek tek gözden geçirmek kullanıcının kararı.
- **(G1-16)** **Sesli alarm ve kritik alarm bildirimi gerçek bir serviste denenir** — yeni arayüze
  taşındılar (`<T4>`, `<T5>`), ama yalnız taklit bir Web Audio ve taklit bir `Notification` ile test
  edildiler. Bir servis bilgisayarında, yerel yığında: (1) Ayarlar › "Ses ve bildirim"de ses açılır
  ve "Sesi dene" hoparlörden kritik düzeni (10 vuruş, 5+5) çalar; (2) kritik bir alarm gelince ses
  çalar, yüksekte ve ortada daha seyrek; alarm "Gördüm" ile onaylanınca susar; (3) ekran kilitlenir
  — ses sürer; çıkış yapılır — ses durur; (4) sayfa yenilenir — "Siqnal səsi gözləmədədir…" düğmesi
  görünür, bir tıklamayla kalkar; (5) bildirime izin verilir, başka bir pencere öne alınır, kritik
  bir alarm gelir — Windows bildirimi yatak adıyla görünür; kilitliyken gelen bildirim yatak adı
  taşımaz; (6) adres HTTPS değilse ekran bildirimlerin çalışmadığını söyler. VM HTTP üzerindeyse
  bildirim hiç çalışmaz (eski derlemede de çalışmıyordu) — bu deploy kapısında söylenir.
```

**3d, `?eski=1` in the gate (lines 192–193).** Replace:
```markdown
- **(Dalga 2)** `?eski=1` (önceki canlı arayüz) G1-16 ile kaldırıldı: kilit ekranını bilmez, kilitli
  bir tarayıcıda açık oturumu gösterir.
```
with:
```markdown
- **(Dalga 2)** `?eski=1` (önceki canlı arayüz) G1-16 ile kaldırıldı ✅ (`<T6>`): kilit ekranını
  bilmiyordu, kilitli bir tarayıcıda açık oturumu gösteriyordu. Adres artık canlı arayüzü açar.
```

**3e, the G1-15 walk, step 2 (lines 272–274).** Replace:
```markdown
   sayısı kaydedilir (Dalga 2 sonu: 145 kB / 47 kB gzip, 22 kayıt / 556 KiB). İlk parça yaklaşık
   250 kB gzip'i geçtiyse söylenir, burada düzeltilmez: bölme G1-16'nın işi.
```
with:
```markdown
   sayısı kaydedilir (Dalga 2 sonu: 145 kB / 47 kB gzip, 22 kayıt / 556 KiB; G1-16 sonu: 146,74 kB
   / 48,02 kB gzip, 20 kayıt / ~735 KiB, 500 kB'ı geçen parça yok). İlk parça yaklaşık 250 kB
   gzip'i geçtiyse söylenir. G1-16 bölmeye gerek görmedi: ilk parçanın neredeyse tamamı React;
   `routing.test.js` ilk parçaya statik olarak giren importları sabitler.
```

**3f, the waves table (line 319).** Replace:
```markdown
| 4 | G1-16 → G1-15 | Sıralı |
```
with:
```markdown
| 4 | G1-16 → G1-15 | Sıralı; G1-16 ✅ |
```

**3g, "G1-16 sonu" after the Wave 3B paragraph.** Replace:
```markdown
bakış (390/1440 px, iki tema) **yapılmadı**: kullanıcının işi, aşağıda "Dalga 3B'den açık kalanlar".
```
with:
```markdown
bakış (390/1440 px, iki tema) **yapılmadı**: kullanıcının işi, aşağıda "Dalga 3B'den açık kalanlar".

G1-16 sonu (son kod commit'i `<T8>`): dashboard 1782 geçti (75 dosya) — G1-16'nın tabanından
(`69f059f` / `126a011`: 2430 / 108) 648 test ve 33 dosya eksik: silinen kodun 37 test dosyası
gitti, taşınan ses ve bildirimin 4'ü geldi (36 test). Yeni arayüzün kendi testleri (`src/live/`)
yalnız bu taşımayla 62 dosya / 1504'ten 65 / 1540'a çıktı; hiçbir silme ondan bir şey almadı.
Vite build tamam, 500 kB uyarısı yok: ilk parça 146,74 kB / 48,02 kB gzip, `LiveApp` 205,05 kB /
63,20 kB, ortak parça (`Toast`) 186,00 kB / 68,41 kB; servis çalışanı 20 kayıt / ~751 KiB (önce
22 / ~785). Arka uçta yalnız üç yorum değişti (`tests/test_nginx_routes.py` 40 geçti, Python
3.12). Tarayıcıda eski adreslerin ve gerçek bir hoparlörün denenmesi kullanıcıda ve G1-15'te
(G1-16 planı, "Needs the user"). (Taban ya da sayılar farklıysa Görev 10'un yazdırdıkları yazılır.)
```

**3h, the unconnected modules (after line 477).** Replace:
```markdown
- `patientScope.js` ekran kapsamı (rol yerine izin modeline uyarlanmalı) → G1-12
```
with:
```markdown
- `patientScope.js` ekran kapsamı (rol yerine izin modeline uyarlanmalı) → G1-12

**G1-16 bu modüllerin hepsini sildi** (`<T1>`): sayfadan hiçbiri erişilebilir değildi ve
`reachable.test.js` artık bunu yasaklıyor. Hedefleri değişmedi; kodları ve testleri `e4cdf15`'te
okunur (`git show e4cdf15:dashboard/src/<dosya>`). Liste aşağıda "G1-16'da silinenler".
```

**3i, `simulationGating` (line 509).** Replace:
```markdown
"sonuç simüle et", DEMO etiketi) hiç çizilmez; mod belirtilmezse varsayılan canlıdır. → G1-16
```
with:
```markdown
"sonuç simüle et", DEMO etiketi) hiç çizilmez; mod belirtilmezse varsayılan canlıdır. → G1-16 ✅ Simülasyon koddan çıktı (`<T6>`): her adres canlı sistemi açar, yalnız `?tasarim=1` tasarım galerisini.
```

**3j, the language cases (line 512).** Replace:
```markdown
`i18n.rbac.test.js`'teki eski vakalar eski çalışma alanını G1-16'ya kadar korur.
```
with:
```markdown
`i18n.rbac.test.js`'teki eski vakalar eski çalışma alanıyla birlikte G1-16'da silindi (`<T6>`).
```

**3k, the manifest (line 538).** Replace:
```markdown
Her tablette yeniden eklenmesi G1-15 deploy kapısında.
```
with:
```markdown
Her tablette yeniden eklenmesi G1-15 deploy kapısındaydı; G1-16'dan beri o adres de canlı sistemi açıyor, yeniden ekleme yalnız kurulu uygulamanın adını ve dilini tazeler (kullanıcının kararı).
```

**3l, the demo admin password (line 541).** Replace:
```markdown
- `clinicalDemo.js:475`'teki demo yönetici parolası git geçmişinde; gerçek bir yerde kullanıldıysa değiştirilmeli. → kullanıcıya not
```
with:
```markdown
- `clinicalDemo.js:475`'teki demo yönetici parolası git geçmişinde; gerçek bir yerde kullanıldıysa değiştirilmeli. → kullanıcıya not (G1-16 dosyayı sildi; parola `e4cdf15` ve öncesinde, `origin`'de de, kalır)
```

**3m, the precache (lines 734–735).** Replace:
```markdown
  önbellekten çıktı, 31 kayıt/1245 KiB → 22 kayıt/556 KiB. Galeri parçası (`?tasarim=1`) ve
  fontlar hâlâ önbellekte → G1-16.
```
with:
```markdown
  önbellekten çıktı, 31 kayıt/1245 KiB → 22 kayıt/556 KiB. Galeri parçası (`?tasarim=1`) ve
  fontlar hâlâ önbellekte → G1-16. ✅ G1-16 (`<T8>`): galeri parçası da çıktı
  (`globIgnores: ["**/DesignGallery-*.js"]`), 20 kayıt / ~735 KiB; fontlar canlı arayüzün, kalır.
```

**3n, `?eski=1` and the lock (lines 743–744).** Replace:
```markdown
  `?eski=1` açılırsa oturum açık görünür → G1-16 kaldırır (G1-15 deploy'undan önce).
```
with:
```markdown
  `?eski=1` açılırsa oturum açık görünür → G1-16 kaldırır (G1-15 deploy'undan önce). ✅ `<T6>`:
  `?eski=1` canlı arayüzü açar.
```

**3o, `/notifications` (lines 778–779).** Replace:
```markdown
- `/notifications` akışının kalp atışı (heartbeat) yok; yalnız eski çalışma alanı okuyor →
  G1-16'yla birlikte kalkar, kalacaksa kalp atışı eklenir.
```
with:
```markdown
- `/notifications` akışının kalp atışı (heartbeat) yok; yalnız eski çalışma alanı okuyor →
  G1-16'yla birlikte kalkar, kalacaksa kalp atışı eklenir. **G1-16: uç kalır** — panoda okuyan
  kalmadı (eski pano ve `api.js` silindi) ama mobil uygulama okuyor
  (`homunculus-mobile/src/transport/sseTransport.ts`, `/notifications?role=…`) ve onun da sessizlik
  bekçisi yok. Kalp atışı → Grup 5 (mobil).
```

**3p, a new section before the user decisions.** Replace:
```markdown
## Kullanıcı kararları (Dalga 0 sonrası)
```
with:
```markdown
## G1-16'dan açık kalanlar

Plan: [G1-16](2026-10-13-g1-16-eski-modlari-kaldir.md). Silinen her dosya `e4cdf15`'te okunur
(`git show e4cdf15:dashboard/src/<dosya>`); o commit `origin/feat/canli-tasarim`'de de var.

- ✅ **Sesli alarm ve arka plan bildirimi taşındı** (`<T4>`, `<T5>`; kullanıcı kararı 13.10) —
  `live/signals/`. Eskisi gibi: aynı IEC 60601-1-8 düzenleri, yanıt bekleyen en kötü alarm, gizli
  sayfada kritik alarm başına bir bildirim. Yeni: kilitte de çalar, kilitliyken bildirim yatak adı
  taşımaz, oturum bitince ses durur ve bildirimler kapanır; ayar tarayıcıda saklanır ve tarayıcı
  sesi başlatana kadar "bekliyor" der. Bilinmeyen bir önem derecesi kritik gibi çalar (eskisi
  sessizdi). Açık kalan: gerçek hoparlör ve Windows bildirimi denemesi (yukarıda G1-15 kapısı).
- **Bildirim yatağın etiketini taşır, etiket yoksa hasta kimliğini** — eskisi de böyleydi
  (`liveAdapters.js` `bedLabel`), bilerek korundu. Bilgisayar açıkken arka plandaki bildirim
  Windows'un bildirim alanında kalır (`requireInteraction`). → kullanıcı kararı.
- **Üst çubukta ses göstergesi yok** (eskisinde düğme vardı); ayar Ayarlar'da, bekleyen ses için
  ekranın köşesinde bir düğme. Üst çubuğa bir gösterge eklemek tasarım kararı. → kullanıcı / tasarımcı.
- **Vercel'deki genel yayın** (`homunculus-ai.vercel.app`) ve arkasındaki Render API'si hâlâ açık;
  kod tarafında demo kalmadı. `main`'e her push Vercel'i yeniden derler (`docs/DEPLOY-SUPABASE.md`):
  bu dal main'e birleşirse o adres simülasyonu değil canlı arayüzün giriş ekranını gösterir.
  Yayından kaldırma ve `vercel.json` / `render.yaml` / `dashboard/.env.production`'ın akıbeti
  → kullanıcı.
- `homunculus-engine/scripts/record_demo.py` (+ `test_record_demo.py`, `test_record_ward.py`)
  replay'in JSON'unu üretiyordu; artık okuyanı yok. Senaryo YAML'ları kalır (motor testleri ve
  `scripts/replay.py`). → Grup 4 (temizlik) ya da kullanıcı.
- `lucide-react` paketi artık kullanılmıyor (Vite ağaçtan atar, paket ağırlığı yok); kaldırmak
  bütün G1 worktree'lerinin paylaştığı `node_modules` bağlantısında `npm uninstall` demek. → Grup 4.
- `liveAdapters.js`'in eski uyarı alanları (`tier`, `firedAtSec`, `currentStep`, `events`,
  `snooze`, `mutedUntil`, `auto`, `trigger`) ve canlıda okunmayan üç dışa aktarımı
  (`bedsFromPatients`, `ageFromBirthDate`, `awaitingLocalAdmission`) testleriyle kaldı; ilk
  ikisi Grup 2'nin kabul ekranının sözleşmesi. Yalnız `ack.atSec` gitti (`<T7>`). → Grup 2.
- `/notifications` kalp atışı → Grup 5 (yukarıda "Dalga 2'den açık kalanlar").

**G1-16'da silinenler** (her biri `e4cdf15`'te; testleri koruduğu davranışın kaydıdır):

| Silinen | Testi (test) | Ne yapıyordu → nereye |
|---|---|---|
| `wallBoard.jsx` | `policySettings.test.jsx` (13) | Duvar monitörü + ad maskeleme → Grup 2 |
| `rrtQueue.js` | `rrtQueue.test.js` (11) | RRT kuyruğu → Grup 2 |
| `alarmDensity.js` | `alarmDensity.test.js` (11) | Isı haritası → Grup 2 |
| `severityScore.jsx` | `severityScore.test.jsx` (10) | SOFA formu ve imza → Grup 2 |
| `clinicalAdmin.jsx` | `alarmQualityPanel.test.jsx` (7), `auditIntegrity.test.jsx` (6) | Alarm kalitesi → Grup 4; denetim bütünlüğü → Grup 2 |
| `InfinityBeds.jsx` | `InfinityBeds.test.jsx` (9) | Cihaz sağlığı → Grup 4 |
| `admissionPage.jsx`, `patientLabel.js` | `patientLabel.test.js` (15) | Kabul / transfer / bakım ekibi, barkod etiketi → Grup 2 |
| `patientScope.js` | `patientScope.test.js` (15) | Ekran kapsamı → G1-12 ✅ sunucuda |
| `feedHealth.js` | `feedHealth.test.js` (22) | → G1-09 ✅ `live/screens/common/feedHealth.js` |
| `risk.js` | `risk.test.js` (2) | → G1-09 ✅ `pillRisk` |
| `clinicalUi.jsx`, `ui.jsx`, `clinicalTheme.js` | `ui.test.jsx` (9) | Eski bileşenler ve tema → `live/ui`, `live/theme` |
| `loginHero.jsx` | — | Eski giriş ekranı sahnesi → yok (D4 girişi) |
| `liveStore.js` | `liveStore*.test.js` (48 + 47 + 25), `auditFromEngine.test.js` (12), `clinicalCharting.test.js` (6), `scopeAssignment.test.js` (3) | Eski canlı store → `live/session`, `live/data` ✅; denetim satırı (`auditRowFromRecord`) → Grup 2; klinik girdi → Grup 3; kapsam ataması → G1-12 ✅ |
| `liveAdmin.js`, `admin/*` | `liveAdmin.test.js` (28), `LiveUserAdmin.test.jsx` (35), `GroupAdmin.test.jsx` (20) | → G1-12/13 ✅ `live/screens/admin` |
| `clinicalI18n.js` | `i18n.rbac.test.js` (109) | → G1-06 ✅ `live/i18n`; sunucu iletileri `live/apiErrors.test.js`'te |
| `permissions.js` | `permissions.test.js` (14) | → `live/screens/admin/catalogue.js` ✅ (grupların hakları sunucunun) |
| `clinicalAudio.js`, `ClinicalDemo.jsx`'in bildirimi | — | Sesli alarm, arka plan bildirimi → ✅ silinmeden önce taşındı: `live/signals/` (`<T4>`, `<T5>`) |
| `ClinicalDemo.jsx`, `clinicalDemo.js`, `legacyRoots.jsx`, `DemoDataBanner.jsx` | `ClinicalDemo.rbac.test.jsx` (43), `nav.test.js` (6), `clinicalDemo.test.js` (123), `legacyRoots.test.jsx` (4), `DemoDataBanner.test.jsx` (4) | Simülasyon ve önceki canlı arayüz → yok (D1) |
| `Board.jsx`, `PatientDetail.jsx`, `PatientList.jsx`, `NotificationHistory.jsx`, `Toasts.jsx`, `notifications.js`, `api.js`, `i18n.js`, `theme.js`, `demo.jsx`, `demoTransport.js`, `public/demo/*.json` | 38 test, 9 dosya | Eski pano ve replay → yok (D1) |

## Kullanıcı kararları (Dalga 0 sonrası)
```

Check: `grep -c "G1-16" docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md` goes up, and `grep -n "Bekliyor" <roadmap> | grep G1-16` prints nothing.

- [ ] **Step 4: The Turkish guide.** Edit `docs/homunculus-rehber-TR.md`, five replacements.

**4a, the gallery (around line 326).** Replace:
```markdown
- *Homunculus'ta:* Varsayılan dil Azerbaycanca'dır (yol haritası D2); seçilen dil, tema ve yazı
  boyu tarayıcıda saklanır. Hasta verisi hiçbir zaman çevrilmez — yalnız arayüz metinleri.
```
with:
```markdown
- *Homunculus'ta:* Varsayılan dil Azerbaycanca'dır (yol haritası D2); seçilen dil, tema ve yazı
  boyu tarayıcıda saklanır. Hasta verisi hiçbir zaman çevrilmez — yalnız arayüz metinleri.
  Çevrimdışı önbellekte tutulmaz (G1-16): ağ yokken açılmaz, servis bilgisayarı onu indirmez.
```

**4b, the shell entry (lines 526–527).** Replace:
```markdown
  yoxdur", olmayan bir sayfa "Belə səhifə yoxdur" der. Önceki arayüz G1-16'ya dek `?eski=1` ile
  açılır; o kilit ekranını bilmez.
```
with:
```markdown
  yoxdur", olmayan bir sayfa "Belə səhifə yoxdur" der. Önceki arayüz (`?eski=1`, kilit ekranını
  bilmiyordu) G1-16'da kaldırıldı: o adres de artık bu arayüzü açar (aşağıda "Eski adresler").
```

**4c, the installed app (lines 543–549).** Replace:
```markdown
- *Ana ekrana eklenen uygulama:* Uygulama artık **gerçek sistemle** kurulur — eskiden kısayol
  simülasyonu (`?demo=1`) açıyordu. Bu yalnız **yeni** kurulumlar için geçerli: ana ekranda zaten
  duran bir kısayol, tarayıcı uygulama tanımını yeniden okuyana kadar eski adresi açmayı sürdürür.
  Bu yüzden deploy'dan sonra her tablette uygulamanın yeniden eklenmesi gerekir (G1-15 deploy
  kapısında bir madde). Buna karşılık eski arayüz, demo, replay ve eski pano
  (`?eski=1`, `?demo=1`, `?mode=replay`, `?board=1`) **ağ yokken açılmaz**: bilerek çevrimdışı
  önbelleğin dışında bırakıldılar, böylece servis bilgisayarı yalnız gerçek sistemi indirir.
```
with:
```markdown
- *Ana ekrana eklenen uygulama:* Uygulama **gerçek sistemle** kurulur — Dalga 2'den önce kısayol
  simülasyonu (`?demo=1`) açıyordu. Ana ekranda zaten duran eski bir kısayol, tarayıcı uygulama
  tanımını yeniden okuyana kadar eski adresi açar; G1-16'dan beri o adres de gerçek sistemi açar
  (aşağıda "Eski adresler"). Servis bilgisayarı ilk açılışta yalnız gerçek sistemi indirir.
```

**4d, a new entry right after the shell entry.** Replace:
```markdown
**Active Directory ile giriş**
```
with:
```markdown
**Eski adresler (G1-16)**
- *Basit:* Panonun eski hâllerine götüren adresler artık hep gerçek sisteme götürür; yer imleri ve
  eski kısayollar boş sayfa ya da hata göstermez.
- *Homunculus'ta:* Simülasyon (`?demo=1`, `#/demo`), önceki canlı arayüz (`?eski=1`), replay
  (`?mode=replay`, `?scenario=…`) ve eski pano (`?board=1`, `&token=…`) G1-16'da koddan çıktı. Bu
  adreslerden biriyle açılan sayfa gerçek sistemin giriş ekranını gösterir ve parametre daha
  hiçbir şey çizilmeden adres çubuğundan silinir: gerçek hastaların üstünde "demo" yazan bir adres
  kalmaz, eski panonun adreste taşıdığı cihaz anahtarı da geçmişte kalmaz. `?live=1` eskisi gibi
  kabul edilir; `?tasarim=1` tasarım galerisini açar. Silinen kod `e4cdf15` commit'inde okunur.
  Vercel'deki genel demonun yayından kaldırılması kod işi değil, kullanıcının işidir.

**Alarm sesi ve kritik alarm bildirimi**
- *Basit:* Yanıt bekleyen bir alarm varken servis bilgisayarı ses çıkarır; sayfa arka plandayken
  kritik bir alarm için Windows bir bildirim gösterir. İkisi de bu tarayıcıda açılır.
- *Homunculus'ta:* Ayarlar › "Ses ve bildirim". **Ses** (kapalı başlar, açılınca bu tarayıcıda
  saklanır): yanıt bekleyen alarmların en kötüsüne göre IEC 60601-1-8 düzeninde çalar — kritikte 2,5
  saniyede bir 10 vuruş (5+5), yüksekte 12, ortada 20 saniyede bir 3 vuruş; düşük ve bilgi
  sessizdir; önem derecesi bilinmeyen bir alarm kritik gibi çalar. Alarm onaylanınca susar. Ekran
  **kilitliyken de çalar**; oturum kapanınca durur. Sunucuyla akış koparsa panonun son bildiğini
  çalmaya devam eder; pano hiç okunamıyorsa çalmaz. Tarayıcılar sesi ancak bir tıklama ya da tuş
  vuruşundan sonra başlatır: sayfa yeniden açıldıysa ses "bekliyor"dur ve ekranın köşesindeki düğme
  bunu söyler — giriş ya da kilit açma için yazmak da sesi başlatır. "Sesi dene" bir kritik düzen
  çalar. **Bildirim** (tarayıcı izin isterse "İzin ver"): sayfa arka plandayken her yeni kritik
  alarm için bir bildirim, yatağın etiketiyle (etiket yoksa hasta kimliğiyle — eski arayüzdeki gibi);
  ekran kilitliyken bildirim yatak adı taşımaz. Sayfa kapalıysa bildirim gelmez; adres HTTPS değilse
  tarayıcı bildirimleri hiç göstermez. Eski arayüzden taşındı (G1-16).

**Active Directory ile giriş**
```

**4e, "Live mode: nothing simulated" (lines 738–752).** Replace:
```markdown
- *Homunculus'ta:* Yeni arayüzde (yalın adres ya da `?live=1`) simülasyon hiç yok: ekranlar
  yalnız gerçek API'nin yaptıklarını çizer; arkasında bir uç olmayan ekran ya da düğme yoktur
  (yukarıda "Yeni canlı arayüz", aşağıda 3.6). Önceki canlı arayüz (`?eski=1`, G1-16'da kalkacak)
  ise simülasyonla aynı ekranları kullandığı için şunları gizleyerek çalışır:
  - simülasyona dayanan yönetim sekmeleri (raporlar, yapı, cihazlar, denetim, arşiv, oturumlar,
    güvenlik) ve simülasyona dayanan klinik sayfalar;
  - simülasyon kontrolleri (alarm tetikleme, zaman ölçeği, break-glass, çevrimdışı ve otomatik
    alarm anahtarları);
  - alarm kartındaki "RRT'ye Eskale Et", "Sessize Al" ve "Ertele" düğmeleri, onayın nedeni ve
    notu.

  Orada da simülasyon saati ve otomatik alarm motoru durur; gerçek bir alarmın yaşı duvar saatine
  göre sayılır. Demo modu (`?demo=1`) eskisi gibi her şeyi gösterir; G1-16'da o da kalkar.
```
with:
```markdown
- *Homunculus'ta:* Panoda simülasyon yok: ekranlar yalnız gerçek API'nin yaptıklarını çizer;
  arkasında bir uç olmayan ekran ya da düğme yoktur (yukarıda "Yeni canlı arayüz", aşağıda 3.6).
  G1-16'dan beri tek arayüz budur — simülasyon (`?demo=1`) ve onunla aynı ekranları kullanan önceki
  canlı arayüz (`?eski=1`) koddan çıktı (yukarıda "Eski adresler"). Önceki arayüzün **sesli
  alarmı** ve arka plandaki **kritik alarm bildirimi** silinmeden önce yeni arayüze taşındı
  (yukarıda "Alarm sesi ve kritik alarm bildirimi").
```
If any of the five old texts does not match (the guide moves often), find the passage with `grep -n "eski=1\|demo=1" docs/homunculus-rehber-TR.md` and apply the same change in substance. Then `grep -n "?eski=1\|?demo=1" docs/homunculus-rehber-TR.md` should print only lines that say the address is gone.

- [ ] **Step 5: The two deploy docs.** Edit `docs/DEPLOY-SUPABASE.md`. Replace:

```markdown
> **Not:** Public **demo** (`?demo=1` → ClinicalDemo) tamamen tarayıcı-içidir ve buna İHTİYAÇ DUYMAZ.
> Bu runbook, **gerçek sistem** (`?live=1` → gerçek login/MFA, kalıcı Postgres) içindir. Yalnızca
```
with:
```markdown
> **Not:** Tarayıcı-içi public **demo** (`?demo=1`) G1-16'da koddan çıktı; o adres de artık gerçek
> sistemi açar. Bu runbook, **gerçek sistem** (yalın adres ya da `?live=1` → gerçek login/MFA, kalıcı
> Postgres) içindir ve Vercel/Render yayını yayından kaldırılana dek geçerlidir. Yalnızca
```
Replace:
```markdown
3. Gerçek sistem: `https://homunculus-ai.vercel.app/?live=1` → login ekranı **gerçek** backend'e gider.
   Public demo (`/?demo=1`) değişmeden çalışmaya devam eder.
```
with:
```markdown
3. Gerçek sistem: `https://homunculus-ai.vercel.app/` → login ekranı **gerçek** backend'e gider.
   (G1-16'dan beri `/?demo=1` ve `/?live=1` de aynı ekranı açar; demo yok.)
```
Edit `docs/EDGE-BRIDGE-LOCAL.md`. Replace:
```markdown
The board still draws its patients and alerts from the simulation, and carries a banner saying so.
Real device data is verified through `/patients`, `/alerts/{patient_id}` and the audit table.
Phase 2 wires the board to live data and removes the banner.
```
with:
```markdown
The dashboard shows live data only: since G1-16 there is no simulation and no demo-data banner in
it, and every address opens the live UI (sign-in, then the beds, alarms and patient screens).
Device data can also be checked directly through `/patients`, `/alerts/{patient_id}` and the audit
table.
```

- [ ] **Step 6: The spec's as-built notes.** Edit `docs/superpowers/specs/2026-09-23-ldap-rbac-design.md`. Replace:

```markdown
**The device path is unchanged.** A static tenant token (the bridge's `/ingest` credential, and
the legacy `?board=1` screen) is a machine identity and is exempt from permission checks.
```
with:
```markdown
**The device path is unchanged.** A static tenant token (the bridge's `/ingest` credential, and
the legacy `?board=1` screen — removed from the dashboard in G1-16) is a machine identity and is
exempt from permission checks.
```
Replace:
```markdown
## 8. Dashboard
```
with:
```markdown
## 8. Dashboard

> *As built (G1-16):* this section describes the **previous** dashboard workspace —
> `ClinicalDemo.jsx`, `clinicalDemo.js`, `liveStore.js`, `permissions.js`, `admin/*` — which G1-16
> deleted (readable at `e4cdf15`). The live UI that replaced it: session and token reading
> `src/live/session/sessionStore.js` over `src/liveAuth.js`; navigation `src/live/shell/routes.js`
> (gated on `perms`); administration `src/live/screens/admin/` (Wave 3B); the catalogue mirror
> `src/live/screens/admin/catalogue.js`. There is no simulated mode any more.
```

- [ ] **Step 7: The working notes (outside the repo).** Append to `/c/tmp/homunculus-plans/amendments.md`:

```markdown

## From G1-16 (as built, `<T1>`..`<T8>`) — binding for G1-15 and every later wave
- **There is one root.** `main.jsx` renders the live UI, or the design gallery on `?tasarim=1`.
  `chooseMode` returns `"live"` | `"tasarim"`; `AppShell` takes no `mode`; there is no banner.
- **`src/reachable.test.js`: every production module under `src/` must be reachable from
  `main.jsx`** (the shared `importsOf` walk). A module "kept for later" fails it. Wire it in or
  leave it in git. Never write `import (` or `import "x"` into a comment under `src/`: the reader
  takes it for an import.
- **`routing.test.js` pins `main.jsx`'s static imports** (`@fontsource-variable/figtree`,
  `./index.css`, `react`, `react-dom/client`, `./LoadFailed.jsx`) **and its lazy imports**
  (`./live/LiveApp.jsx`, `./live/gallery/DesignGallery.jsx`). A new root (e.g. `?infinityTest=1`)
  is a lazy branch in `pickRoot` plus one entry in that list.
- **`withoutRetired(location)`** strips `demo`, `eski`, `board`, `token`, `scenario`,
  `mode=replay` (only that value) and a `#/demo` hash, once, at load, by `replaceState`. A
  parameter a new feature reads must not be one of those.
- `permissions.js` is gone: the dashboard's only catalogue mirror is
  `live/screens/admin/catalogue.js`; a test needing a default group's rights reads
  `auth/permissions.py` (see `liveAuth.test.js` `backendPermsOf`).
- `alertsFromPatients`: `ack` is a presence flag (`{by, reason: null, note: null}`); the instant is
  `ackAtMs` only.
- Precache: `globIgnores: ["**/DesignGallery-*.js"]`, 20 entries. Tailwind: no `brand`, no `sev`, no
  `darkMode`; `font-sans` is the page's (index.css / LoadFailed). `index.html` is `lang="az"`.
- **The alarm sound and the critical-alarm notification live in `src/live/signals/`** (`<T4>`, `<T5>`):
  `signals.js` is the ONE mapping (waiting alarm → pattern / notification; reads `waitingAlarms`,
  an unknown severity is critical); `alarmSound.js` the engine (clinicalAudio.js's numbers);
  `AlarmSignals.jsx` the provider, mounted OUTSIDE the phases in `LiveApp.jsx` — it must stay there:
  the shell unmounts at the lock and a locked ward PC must still alert. `seesBoard(phase, user)`
  (sessionStore.js) is the one rule for "this session may see the board"; the board and the sound
  both read it. While LOCKED a notification names no bed. A new screen that wants the sound's state
  reads `useAlarmSignals()`; nothing else may play audio or raise a `Notification`.
- `mount()` (mount.testutil.jsx) wraps every test in `<AlarmSignals>`; inert in jsdom. A test that
  needs Web Audio or Notification uses `signals/fakeAudio.testutil.js` (`fakeAudio`,
  `fakeNotifications`, `onPage` — undo it), with the fake-timer recipe above.
- Counts at `<T8>`: dashboard 75 files / 1782 tests (`src/live/` 65 / 1540), build clean with no
  500 kB warning, first chunk 146.74 kB / 48.02 kB gzip.
```
Append to `/c/tmp/homunculus-plans/deferred.md`:
```markdown

## From G1-16 (2026-10-13), deliberately left
- CLOSED: the alarm sound and the background critical-alarm notification were ported before the old
  workspace went (`<T4>`, `<T5>`, the user's decision). Left: a real speaker and a real Windows
  notification have not been tried (G1-15 gate); the notification names the bed label, else the
  patient id, as the old one did (user); no sound indicator in the top bar (design).
- `/notifications` stays (mobile reads it; no heartbeat, mobile has no silence watchdog) → Group 5.
- `scripts/record_demo.py` + its two tests: no consumer since the replay went → Group 4 / user.
- `lucide-react` unused; removal = `npm uninstall` on the shared junction → Group 4.
- `liveAdapters.js` old alert fields and three unused exports kept with their tests → Group 2.
- Vercel / Render public deployment and `vercel.json`, `render.yaml`, `dashboard/.env.production`
  → user.
```

- [ ] **Step 8: Gate.** Documents and comments only. The dashboard was run in Step 1 (`apiErrors.test.js` 137) and the engine file there too (40).

```bash
cd /c/tmp/g116-impl
grep -rn "<T[0-9]>\|<gün.ay>" docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md docs/homunculus-rehber-TR.md docs/DEMO-DEPLOY.md || echo "no placeholders"
git status --short
```
Expected: `no placeholders`, and exactly these modified: the roadmap, `docs/homunculus-rehber-TR.md`, `docs/DEMO-DEPLOY.md`, `docs/DEPLOY-SUPABASE.md`, `docs/EDGE-BRIDGE-LOCAL.md`, `docs/superpowers/specs/2026-09-23-ldap-rbac-design.md`, `homunculus-engine/tests/test_nginx_routes.py`, `homunculus-engine/src/homunculus/admin/service.py`. If `__pycache__` shows up as untracked under the engine, leave it unstaged; it is ignored in the commit.

- [ ] **Step 9: Commit**

```bash
cd /c/tmp/g116-impl
git add docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md docs/homunculus-rehber-TR.md docs/DEMO-DEPLOY.md docs/DEPLOY-SUPABASE.md docs/EDGE-BRIDGE-LOCAL.md docs/superpowers/specs/2026-09-23-ldap-rbac-design.md homunculus-engine/tests/test_nginx_routes.py homunculus-engine/src/homunculus/admin/service.py
git status --short
git commit -m "$(cat <<'EOF'
docs: G1-16 — the dashboard is the live system only; what went, where it went, and what is left

The roadmap's G1-16 row, D1, the G1-15 gate (the tablet icon now opens the live system; the
ported alarm sound and critical-alarm notification are tried on a real speaker and a real Windows
notification there), the build's numbers, and a table of every deleted module with its target
group. The Turkish guide gains "Eski adresler" and "Alarm sesi ve kritik alarm bildirimi";
DEMO-DEPLOY.md says the demo is gone and that the Vercel
deployment is the user's to take down; DEPLOY-SUPABASE, EDGE-BRIDGE-LOCAL and the RBAC spec stop
describing a simulation. Two engine comments named clinicalI18n.js.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

**Gate:** the eight files updated, no placeholder left, the two working notes appended; `test_nginx_routes.py` 40 passed; `apiErrors.test.js` 137.

---

### Task 10: Final verification

**Files:** none changed, unless something below fails.

- [ ] **Step 1: The suite, twice, as G1-15's walk will run it.**

```bash
cd /c/tmp/g116-impl/dashboard
npx vitest run 2>&1 | tail -5
```
```bash
cd /c/tmp/g116-impl/dashboard
npx vitest run 2>&1 | tail -5
```
Expected both times: `Test Files  75 passed (75)`, `Tests  1782 passed (1782)` [108 / 2430 at base: −33 files, −648 tests].

- [ ] **Step 2: The build, against the budget.**

```bash
cd /c/tmp/g116-impl/dashboard
npx vite build 2>&1 | grep -E "\.(js|css) |built in|precache|larger than"
ls dist/assets | grep -cE "legacyRoots|browser-" ; ls dist | grep -c demo
```
Expected: no `larger than 500 kB` line; `index-…js` ≤ 150 kB and ≤ 50 kB gzip (measured 146.74 / 48.02); `LiveApp-…js 205.05 kB`; `precache  20 entries`; `0`; `0`.

- [ ] **Step 3: Nothing is left that names a removed mode as alive.**

```bash
cd /c/tmp/g116-impl
grep -rnE "eski=1|demo=1|mode=replay|board=1" dashboard/src dashboard/vite.config.js dashboard/index.html | grep -v "^dashboard/src/main.jsx:\|^dashboard/src/routing.test.js:\|^dashboard/vite.config.js:\|^dashboard/src/devProxy.test.js:" || echo "clean"
grep -rln "ClinicalDemo\.jsx\|liveStore\.js\|clinicalI18n\.js\|legacyRoots" dashboard/src --include=*.js --include=*.jsx
git -C /c/tmp/g116-impl diff --stat feat/canli-tasarim..feat/g1-16 | tail -1
```
Expected, measured on the replay: `clean`. The four files left out name a retired address on purpose: the code that retires them, its test, and the manifest's history. The second `grep` prints exactly these ten, every one a fixture or a record of where something came from: `devProxy.test.js` (the assertion that `legacyRoots` is absent), `live/boundaries.test.js` (the reader's own fixtures), `live/auth/SessionWait.jsx`, `live/data/boardStore.js`, `live/session/sessionStore.js`, `live/i18n/strings/errors.js`, `live/i18n/strings/signals.js`, `live/signals/AlarmSignals.jsx`, `live/signals/AlarmSignals.test.jsx` and `live/signals/signals.test.js`. The stat line reads `125 files changed`: 80 deletions; 10 new (`reachable.test.js`, the 8 of the port, and this plan); 29 edited dashboard and engine files; 6 documents.

- [ ] **Step 4 (optional, no browser driver here): look at it.** On the local stack (`deploy/local`, or `npm run dev` against a local API), open `/?demo=1`, `/#/demo`, `/?eski=1`, `/?mode=replay&scenario=septic_shock` and `/?board=1&token=x`. Each must show the live UI's sign-in, with the address bar reading `/` (and nothing else). Then `/?tasarim=1` shows the gallery. Then Task 5 Step 5 (a real speaker, a real notification). Record what you saw, or hand it to the user (**Needs the user, 3 and 6**).

- [ ] **Step 5: Hand over.** Print the commits for the controller:

```bash
git -C /c/tmp/g116-impl log --oneline feat/canli-tasarim..feat/g1-16 | cat
```
Expected: ten commits (the plan and Tasks 1–9). Bringing them onto `feat/canli-tasarim` (`git -C /c/tmp/homunculus-g1 merge --ff-only feat/g1-16`) is the controller's call, as in Wave 3B. Nothing is pushed.

**Gate:** 75 / 1782 twice; build within budget; no live reference to a removed mode; ten commits.

---

## Needs the user

None of these blocks executing the plan. Items 1–3 must be answered before the **G1-15 deploy**. The two decisions the first edition asked for are made (13.10): the sound and the notification are ported (Tasks 4–5), and the 13 unreachable modules are deleted (Task 1).

1. **Take down the public Vercel demo**, and decide about the Render API and Supabase behind it (D1: "Vercel'deki genel demo da kalkar — yayından kaldırma kullanıcının işi"). The code no longer has a demo. `docs/DEPLOY-SUPABASE.md` says every push to `main` redeploys Vercel, so if this branch reaches `main` while the project is connected, `homunculus-ai.vercel.app` will show the live UI's sign-in against the Render API rather than nothing. Also decide whether `vercel.json`, `render.yaml`, `dashboard/.env.production` and `docs/DEPLOY-SUPABASE.md` stay in the repo. This plan keeps them because they describe a deployment that still exists.
2. **ANSWERED 13.10 — keep it as the old build had it** (the bed label, else the patient id, while the app is unlocked; nothing named while this app is locked — the lock screen names no one). Task 4 is written that way already; no change. The question as it was asked: **The critical-alarm notification names a bed — or a patient id.** The old one's body was the alarm's bed label, and the adapter falls back to the **patient id** when the HIS gives no bed label (`liveAdapters.js` `bedLabel`). The port keeps that, as instructed, and flags it. It is shown by Windows outside the page, and stays until dismissed (`requireInteraction`). Depending on Windows' settings it may appear over another application or in the notification centre, where a passer-by can read it. While **this app** is locked, the port names no bed. Keep the bed and id when the app is unlocked, show only the bed label (no id), or name nothing at all?
3. **Try the sound and the notification for real** (Task 5 Step 5; the G1-15 gate gains the list, Task 9). Everything here was tested against a fake Web Audio and a fake `Notification`. On a ward PC: does the speaker sound the patterns, does Windows show the notification, does the "waiting" button appear after a restart? One more thing to know: **a browser shows notifications only on HTTPS.** If the hospital VM serves the panel over plain HTTP, the notification will never appear, as it never did in the old build there. The Settings tab says so on the screen.
4. **A sound indicator in the top bar?** The old top bar had sound and notification buttons on every screen. The port puts the choice in Settings, plus a button in the corner whenever a wanted sound is waiting for a click. Whether the shell should always show the sound's state is a design question for the designer.
5. **The demo admin password** (`clinicalDemo.js:475`) leaves the tree but stays in git history and on `origin`. If it was ever used on a real system, change it there. (An existing roadmap note; G1-16 only moves it to history.)
6. **A look in a browser** (Task 10 Step 4): the retired addresses land on the sign-in with a clean bar; the new Settings tab at 390 px and 1440 px. There is no browser driver on this machine.
7. **`scripts/record_demo.py`** and its two tests now produce files nothing reads. Keep them as engine tooling, or delete them in Group 4. It is a Python change, so it is not made here.
8. **The G1-15 gate item "re-add the app on every tablet"** is no longer needed for correctness: an old icon now opens the live system. Keep it, or drop it.
9. **FYI, two deliberate departures from the old build** (Decisions 17 and 19). An alarm whose severity this build does not know sounds as critical; the old one was silent there, and today's engine sends no such severity. And the sound's on/off is remembered by the browser instead of resetting at every page load.

---

## Self-review

- **Arithmetic, files.** 108 − 11 + 1 = **98** (T1). 98 − 9 = **89** (T2). 89 (T3). 89 + 3 = **92** (T4). 92 (T5). 92 − 17 = **75** (T6). 75 (T7, T8). Test files: 37 deleted, 4 new (`reachable`, `signals`, `alarmSound`, `AlarmSignals`). 108 − 37 + 4 = 75 ✓.
- **Arithmetic, tests (the same at `69f059f` and `126a011`).** T1: 2430 − 121 + 3 = **2312**, where 121 = 9 + 11 + 7 + 6 + 22 + 15 + 15 + 13 + 2 + 11 + 10. T2: 2312 − 38 − 2 + 7 = **2279**, where 38 = 7 + 1 + 5 + 5 + 3 + 3 + 10 + 2 + 2. T4: 2279 + 32 = **2311**, where 32 = 8 + 9 + 14 + 1. T5: **2315** (+4). T6: 2315 − 534 = **1781**, where 534 = 2 + 43 + 123 + 48 + 47 + 25 + 12 + 6 + 3 + 109 + 9 + 20 + 35 + 28 + 14 + 6 + 4. T8: **1782**. Net −648 ✓. Every absolute was printed by a replay. `src/live/`: 62 / 1504 → 65 / 1540 (the port), then unchanged; outside it: 46 / 926 → 10 / 242. Without the port, at `e4cdf15`, the same removal gave 2415 → 1731.
- **Files touched.** 80 deleted (75 under `src/`, 5 under `public/demo/`), 27 dashboard files modified, 9 dashboard files created, matching the `wt4` replay's `git status` (80 `D`, 27 `M`). Plus the 2 engine comments, 6 documents and this plan.
- **Every red step and every build was observed.** T1: 2 failed | 1 passed, then 1 | 2 after Step 3. T2: 9 | 15. T4: the rule and the engine unresolved, the net naming the two unmounted modules, the provider unresolved, the LiveApp test `[]` against `[640, 640, 640]`. T5: 4 | 4. T6: 7 | 17. T7: 1 | 49. T8: devProxy 2 | 3, tailwind 1 | 11. A build after each of Tasks 0–8. The `wt4` replay, built from this document's text alone, equals the tree the port was developed in. The 26 document anchors of Task 9 occur exactly once at `69f059f` and at `126a011`.
- **The user's two decisions are honoured.** The port (Tasks 4–5) lands before Task 6, which deletes `clinicalAudio.js` and `ClinicalDemo.jsx`. Task 1, which deletes the 13 unreachable modules, is unchanged.
- **The coordinator's honesty rules, each answered in Task 4.** Not LIVE: the old build sounded a DEGRADED board, so this one does too, said in the rule and its test; connecting or unavailable plays nothing. Never "nothing is waiting": the only outputs are a sound and a notification. A notification on a lock screen: none names a bed while this app is locked, and the old behaviour (bed label, else patient id) is kept while unlocked and flagged (Needs 2). The lock keeps it sounding; sign-out stops it.
- **The brief's list, verified rather than trusted.** `ClinicalDemo.jsx`, `clinicalDemo.js`, `liveStore.js`, `clinicalI18n.js`, `legacyRoots.jsx`, replay, legacy board, `?demo=1` and `?eski=1` are all removed (Tasks 2 and 6). The PWA `start_url` was already fixed in Wave 2. G1-16 adds the precache's gallery exclusion and the old icon's landing. Vercel is the user's (Needs 1). The graph found 32 more modules than the list named, and 13 of them were dead before G1-16 began.
- **The question "does anything in `src/live/` still import `liveStore.js`, `clinicalI18n.js`, `liveAdmin.js`, `LiveUserAdmin`, `GroupAdmin`, `permissions.js` or the old i18n?"** No production file does (`boundaries.test.js`, and the graph). One **test** did: `live/shell/routes.test.js` imported `permissions.js`, fixed in Task 3. Comments mention several of them: provenance comments stay, false ones are fixed in Tasks 6 and 7. The port imports nothing old: `alarmSound.js` is a port of `clinicalAudio.js`, not an import of it.

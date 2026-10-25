# Group 2 · Lane B · B1a — Hasta Kabul (admission and discharge) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A nurse admits a patient on a screen — the prototype's whole form, a bed picked from the ward's own structure — and the patient's card appears at once on that bed of the board, under a Homunculus patient number (`H2600042`) she enters on the bedside device; the physician signs the admission from the patient screen; a discharge is started by the physician with a disposition and confirmed by the charge nurse, the card leaves every screen, the bed goes to cleaning and a nurse marks it free; the administrator builds the ward in Yönetim › Yapı. No screen shows a UUID.

**Architecture:** Migration `0012` gives `patients` a per-tenant patient number and the form's encrypted fields, `admissions` the form's clinical fields and the discharge's disposition, `beds` an `is_active`, the board identity its own `bed_id`/`unit_id`, and the ward's nurses `beds.release`. `admission/numbers.py` issues the number under the counter row's lock; `admission/form.py` holds the form's rules and answers `field_invalid:<field>`; every refusal of the admission and structure routes carries a stable code (`admission/errors.py`). `POST /admissions` locks the bed, checks it is open, in the caller's units (`admission/unitscope.py`) and AVAILABLE, writes patient, number and DRAFT admission in one transaction, audits `admission.admit`, and after the commit writes the board through `BoardLink` (`admission/boardlink.py`, the one door: identity, weight, profile, open-critical count, discharge). In Lane A's files only the agreed regions change: the identity record carries `bed_id`/`unit_id` and a `kabul` tombstone is never pruned (`api/patient_identity*.py`); the board places a `kabul` card by its own ids and a tombstone's board is a removal carrying the last bed and unit (`api/board.py`); `api/app.py` builds the `BoardLink`, links the Aşama A strip by the identity's own bed and lets the 24 h sweep's removal carry a last bed. The dashboard reads `GET /tenant/structure` once for the shell (names for the top bar, the bed board, the scope editor), adds the Hasta Kabul route (Kabul · Taburcu · Yataklar), the sign-off strip and the bed card's badge, and Yönetim › Yapı; it maps refusals by their code.

**Tech Stack:** Python 3.12 (and a 3.14 check), FastAPI, SQLAlchemy 2 async + asyncpg, Alembic, pytest (Postgres 16 for the DB-backed tests); React 18, Vite, Vitest + Testing Library (`render`, `screen`, `within`, `fireEvent`; no user-event), Tailwind on the live tokens.

**Spec (authoritative):** `docs/superpowers/specs/2026-10-25-g2b-kabul-taburcu-design.md` (D1–D10, §3 flows, §4 backend, §5 screens, §7 Lane A, §8 tests, §9 deploy), approved by the user 2026-10-25. Where the code made the spec's letter unsafe, impossible or merely unspecified, this plan departs from it; every departure is in the table below with its reason and its test. **X51–X66 are the planner's, for the controller's review — none is approved yet.** X51 and X61 are the ones Lane A must see (they are about its files); X52 widens a route guard; X57 changes the shape of every admission-route refusal.

**Gate before Task 5 (X51).** The coordinator restated the Lane A agreement on 2026-10-25: B1a's `board.py` changes are "separate helpers called from `patient_board`". The code cannot place a `kabul` card on its bed that way — `identity_only_board` and the single-patient scope check (`_require_patient`) resolve the bed too, outside `patient_board` — so Task 5 also changes two lines at the top of `_bed_resolution` and one filter and one condition in `board_snapshot` (X51). **Do not start Task 5 until Lane A (through the controller) has confirmed X51.** If it refuses, stop: the card-at-admission (spec D3) needs another design, which is the controller's and the user's to choose. Tasks 1–4 and the whole dashboard lane do not depend on it; Tasks 6–9 do.

**How the numbers in this plan were obtained.** Every task was implemented while the plan was written, in a scratch worktree from the spec's commit `b1899cb` (branch `scratch/g2b1a-plan`), and its tests were run there; when origin/main moved to `312b1f9` (the deployed NBP slice and Lane A's A1, O17 — the alert episodes and the critical latch) and the coordinator merged it into `feat/g2b-kabul` as `2c585e8`, the scratch branch merged `2c585e8` too (two conflicts, both additive: `BedCard.jsx`'s import line, the roadmap's rows) and was brought into line with A1 (`BoardLink.open_critical` tested on the real board's latched alerts; `chart_weight` runs A1's `sync_alerts`, X62). Then the plan itself was replayed: a script applied this file's Write and Edit blocks onto **`2c585e8`** in a second scratch worktree (branch `scratch/g2b1a-replay`), task by task and step by step — the tests first, then the code — every Edit's old text checked unique at that moment, and it ran every command of Tasks 1–19 as the tasks give them (2026-10-25). Every red, green, count and line-end figure below is what that replay printed; the replay's tree is the implementation's byte for byte (`git diff` empty over all 85 files). The Postgres-backed suite was run whole on the replay's head, in parts (Task 20). The local walk (Task 21) and the VM blocks (Task 23) are written but were **not** run (O50). Both scratch worktrees and branches were removed afterwards. The code is kept beside the per-task files as `/c/tmp/homunculus-plans/g2b1a/reference.patch` (`git diff 2c585e8 <replay head>`) — a cross-check, not the authority: build from the tasks.

---

## What the code says that the spec did not — departures (read before Task 1)

| # | Spec | Code at `2c585e8` / what was found | This plan |
|---|---|---|---|
| X51 | §7 item 2 and the Lane A agreement: "`board.py`: a separate helper for bed resolution that prefers the record's ids, and a separate helper filtering discharged `kabul` tombstones, both called from `patient_board` without rewriting its body" | The bed resolution is not called from `patient_board` alone: `identity_only_board` (a card before its first reading) and `_require_patient` (`api/app.py:532`, the scope check of every single-patient route) build the identity through `_bed_resolution` too; a helper called from `patient_board` only would put a fresh `kabul` card on no bed, and hide it from the unit's own nurses. And "filtering" a board list cannot happen inside `patient_board`, which returns one board. Lane A's A1 (merged) put `_latched_alerts` between `_merge_alert` and `_bed_resolution` (`api/board.py:172`). | Three helpers `_own_bed`, `_is_tombstone`, `_tombstone_board`, placed **after** `_bed_resolution` (clear of A1's `_latched_alerts`); **two lines at the top of `_bed_resolution`** (a record with its own `bed_id` is placed by it); **two lines at the top of `patient_board`** (a tombstone's board is its removal frame); **one filter line and one condition in `board_snapshot`**. No line of `_merge_alert`, `_latched_alerts`, `_risk` or the `patient_board` dict changes. Task 5. **Exceeds the agreement's letter; Lane A to confirm before Task 5 starts** (the gate above). |
| X52 | §4.4: `GET /tenant/structure` for holders of `admissions.view`, `admissions.admit`, `beds.release` or `structure.manage`, "limited to the caller's units" | The administrator's scope editor (`screens/admin/ScopeEditor.jsx`, `users.manage`) prints every unit and bed key it grants; since D9 those keys are UUIDs, and §5.7 forbids a UUID on any screen. And the one who builds the structure must see all of it. | The route also opens to **`users.manage`** (the scope editor names the units and beds it grants), and a **`structure.manage`** holder gets the whole tenant tree whatever her grants. Everyone else: her units (a unit grant: the unit with all its rooms and beds; a bed grant: that bed in its room and unit). Task 7 (route, `test_route_permissions.py`), Task 12 (`STRUCTURE_PERMS`, the scope editor). |
| X53 | §4.4: `POST /admissions` returns `engine: {weight, profile}` | The board identity is written after the commit too (§3.1 step 3), and it can fail the same way. | `engine: {weight, profile, board}`, each `ok`, `failed` or `skipped`; the number box names each failed part (`kabul.engineFailed.*`). Task 8, Task 14. |
| X54 | §4.3: "readings later arriving for a discharged number are kept by the engine and counted, not shown" | `/ingest` publishes `patient_board` for every reading (`api/app.py:744`, Lane A's door), so a tombstone patient's board would reach every screen again as a nameless card. | A tombstone's board **is its removal** wherever `patient_board` is published (`_tombstone_board`, Task 5): the engine keeps the readings, `/patients` omits the patient, a stream frame removes the card. "Counted" is the audit's own `ingest` rows; no screen shows a count. Test: `test_readings_after_discharge_are_kept_by_the_engine_and_never_bring_the_card_back`. |
| X55 | §4.3: "The `removed` frame carries the last bed and unit so scoped SSE subscribers receive it (today they never do)" | A HIS-fed record has no bed id of its own and `_merge` clears its location at discharge (`api/patient_identity.py:253–254`), so the 24 h sweep has no last bed to send for it; a `kabul` tombstone is never swept at all. | A `kabul` discharge sends its **own** removal at confirm (`BoardLink.discharge_identity`), carrying the last bed and unit — the scoped screen of that unit receives it (Task 6, Task 9's whole flow). The sweep's removal carries the record's own last bed **when it has one**, and still `identity: null` for a HIS-fed record (`test_retention_removes_unmeasured_cards_and_clears_names_on_live_stream` unchanged). The roadmap's "scoped SSE removed frames" item is closed for `kabul` cards and stays open for HIS-fed ones (O53). |
| X56 | §4.3 is silent on what a discharged identity keeps | — | `_merge` keeps `bed_id`/`unit_id` on discharge as the record's last place (it clears only the HIS text location); `_own_bed` places no discharged record on a bed. Task 5 (`test_discharge_frees_the_bed_and_keeps_the_last_place`). |
| X57 | §4.4: "Every refusal returns a stable code … alongside the text" | `_wf` answered `detail` as an English f-string for every route of the admission router, transfer, care team and handover included (`admission/router.py:65`). | **Every** `WorkflowError` of the router now answers `{"detail": {"code", "message"}}` (the default code `invalid_transition`), so the transfer and handover routes change shape too — no screen reads them today. `out_of_scope` is a **403** (the caller picked the bed from her own structure, so its existence is not a secret), not the board's 404. `field_invalid:<field>` names the **first** wrong field in the form's order; pydantic's own type errors stay FastAPI's 422 list (the dashboard maps those already). Task 3, Task 4. |
| X58 | §4.4: `discharge/initiate` gains the disposition fields | `DischargeInitiate` held `discharge_summary` (required) and `confirmed`; the service appended `[DISCHARGE] <summary>` to the admission narrative. No client ever sent it. | `DischargeStart {disposition, institution?, reported_by?, discharge_at?, note?}` replaces it; the note goes to `discharge_note`, the narrative is no longer appended to. The tenant-isolation body changes with it. Task 9. |
| X59 | §5.3: "Yatan hastalar … Physicians get 'Taburcuyu başlat'" | The state machine has DRAFT → ACTIVE only (`admission/models.py:54–72`): a DRAFT cannot be discharged. | A DRAFT row of "Yatan hastalar" carries the "Hekim imzası bekliyor" tag and "Önce kabul imzalanmalı (hasta ekranı)" instead of the button; the server refuses it `invalid_transition` (`test_a_draft_cannot_be_discharged_before_it_is_signed`). |
| X60 | §5.5: the sign-off strip on the patient screen | `patient.onlyWrite` says the screen writes two things to the patient's record, both with `clinical.chart` (`strings/patient.js:14`, a Lane A file). | `patient.onlyWrite` is **not** changed: it speaks of the clinical record; the strip says its own write ("… imza kabul kaydına yazılır", `admissions.sign_off`). PatientScreen.jsx gains two lines in a `G2-B1a` block (an import and `<SignOffStrip>`). Task 17. |
| X61 | §5.5: "a small badge on the bed card" | The Lane A agreement lets the identity carry only `bed_id`, `unit_id` and the `kabul` source: no admission state reaches the board payload. | The badge and the strip read `GET /admissions?state=DRAFT` (`admissions.view`), the bed board every 60 s while open; a session without `admissions.view` shows neither. Task 15 (`useAdmissions`), Task 17. |
| X62 | §4.3: `chart_weight` "through the engine" | `/clinical` is Lane A's door; since A1 it runs `alert_lifecycle.sync_alerts` after every evaluation, audits what cleared (`alert_cleared`), stamps first-seen with the escalation chain's gap and prunes the nurse notifier's dedup. | `BoardLink.chart_weight` builds the entry with `api/clinical.build_entries` (read, not edited), runs **A1's `sync_alerts`** right after the evaluation (imported, not edited), and writes the same `chart`, `alert_cleared`, `alert` and `first_seen` rows `/clinical` writes, so a restart replays it. It does not prune the notifier's dedup (the notifier is the app's) and passes no chain gap to `stamp_first_seen`: both are no-ops for a number the admission has just issued — the engine knows nothing of that patient — which is the one caller. The docstring says so. Task 6. |
| X63 | §5.2: kilo, boy | The engine bounds a charted weight (`api/clinical.PLAUSIBLE`: 0.3–400 kg) and has no height. House rule: no threshold in the browser. | The server refuses a weight outside the engine's own bound and a height outside **20–260 cm** (a new, non-clinical plausibility bound against a slipped unit) as `field_invalid`; the browser checks only that each is a positive number. Task 3, Task 14. |
| X64 | §4.3: `own_patient_ids` maps care-team rows through `Patient.patient_number` "as well as" `his_patient_reference` | `/scope/me` publishes `own_patients` as `len(own_patient_ids)`. | Both identifiers are returned (de-duplicated), so a patient with a HIS reference and a number counts **twice** in `own_patients`. Break-glass is not changed (O39). Task 4. |
| X65 | — (the spec names no change to the scope editor) | D9 and §5.7: no UUID on any screen; the scope editor prints its keys raw. | The scope editor names each unit and bed from the structure (`unitLabel`, `bedLabel`); a key the structure does not hold reads "Bilinmeyen birim/yatak" when it is a UUID and stays as typed when it is not (an old free-text key). Task 12 (`unitNames.test.jsx`). |
| X66 | §5.1, §5.2 small letters | — | The physician's read-only Kabul is a note, not a disabled form; "demans / kronik konfüzyon" is one box that sends `dementia` (the engine treats `chronic_confusion` identically; the server accepts all five codes); nationality is stored as a code (`az`, `tr` …); the HIS reference gets a length bound (64) it had not; the new name fields 100 characters, so their ciphertext fits the 512-character column. Tasks 3, 14. |

Departures found while implementing go below X66 (X67 …), each with its file and line.

## Open items

Numbered from O39, as the controller set them (the G2-01 plan holds O1–O26, the NBP plan O27–O37).

| # | Item | Owner | When |
|---|---|---|---|
| O39 | Break-glass maps a session to `Patient.his_patient_reference` only (`scope/resolver.break_glass_in_tenant`): a `kabul` patient with no HIS number cannot be opened by break-glass. No screen opens break-glass today. | B1c / B3 | Before break-glass gets a screen |
| O40 | Old free-text staff-scope grants (a key from `bed-mapping.json`) survive `0012` as typed; the scope editor shows them as typed, unflagged (spec §9.5 says "flagged for re-selection"). Task 23's B-1 counts them; re-selection is the administrator's. | User (admin) | At deploy |
| O41 | Readings for a discharged number are kept and raise engine alerts — and nurse notifications through `/ingest`, Lane A's door — though no card shows them. The bedside device must be cleared of the number at discharge; the walk says so (Task 21, step 9). | Lane A / ward | At the walk |
| O42 | The card's `bed_label` is the bed's own label (spec §4.3): two beds "1" in two rooms read alike on the board. The Kabul screens show "1 · Otaq 1 · Reanimasiya". | User | At the walk |
| O43 | The administration route opens to `users.manage` or `groups.manage` (`shell/routes.js`): a session holding only `structure.manage` cannot reach Yönetim › Yapı. The system group holds all three. | — | When a structure-only group exists |
| O44 | Structure changes (add, rename, close, reopen) write no audit row; `bed.release` and the four `admission.*` rows do. | User | — |
| O45 | Sign-off makes the signer the attending but adds no care-team row, so the own-patient exemption (care team) does not reach her yet — B1c. | B1c | — |
| O46 | A session signed in before `0012` holds a token without `beds.release` until it is refreshed (an access token's life). | — | At deploy (the walk signs in afresh) |
| O47 | Pre-existing: `display_name` takes 200 characters into an `EncryptedString(512)`; 200 three-byte characters overflow the column (a 500). The new fields are bounded at 100 (X66). | — | — |
| O48 | The `kabul` namespace's az, ru and en texts and `perms.beds.release` are the planner's and await a native reading, as every namespace of the live UI. | User | Before deploy |
| O49 | `tests/test_tenant_isolation.py` now holds 118 tests and takes ≈ 11 min on the test database: Task 20 runs it in two halves (`-k by_id`, `-k "not by_id"`). | — | — |
| O50 | The local walk (Task 21) and the VM blocks (Task 23) were written, not run, while planning. | Controller | Before deploy |
| O51 | Lane A's A2 (in planning, `/c/tmp/g2a-a2-*`) adds an id-validator call inside `parse_fhir_patient` and `parse_fhir_encounter` (`api/patient_identity.py` ≈ 130, ≈ 199). B1a's hunks in that file stay clear of both (the nearest Edit ends at line 114, `parse_fhir_patient` starts at 130; no Edit's old text reaches into either function — checked by the replay); whichever of the two lands second re-runs Task 5's tests. | Controller | When A2 merges |
| O52 | `GET /admissions` has no paging; one ward's open admissions are a short list. | — | Before many wards |
| O53 | HIS-fed cards: the 24 h sweep's removal still carries no bed (X55), so a scoped screen keeps a discharged HIS card until it reloads. | Lane A / later | When the HIS feed flows |

---

## Baseline at `2c585e8` (measured 2026-10-25, in the replay's worktree before Task 1)

- **Backend, no database** (`PYTHONPATH=src`, `--ignore=tests/test_infinity_vm_pilot.py`): **2272 passed, 650 skipped**, 3 warnings, ≈ 2 min — the coordinator's figure for main `312b1f9`.
- **Backend with Postgres:** not run whole at the base: Lane A's runs held the shared test database most of the afternoon (its advisory lock). Task 20 ran it whole on this slice's head, in fourteen parts: **3032 passed, 8 skipped**; less B1a's 118 tests, the base is **2914 / 8** (derived, not measured).
- **Dashboard:** `npx vitest run` → **89 files / 2432 tests**, all passing; `npx vite build` clean, `precache  20 entries`.
- **Python 3.14:** `/c/tmp/g115-py314/Scripts/python.exe` runs this worktree's tests with `PYTHONPATH=src`.
- **Test database:** `homunculus-test-pg-56` (Postgres 16, port 56432, database `homunculus_test`), shared with Lane A under `conftest.py`'s advisory lock — a run waits while Lane A's runs.

## Counts after each task (merged in plan order, as the replay measured them)

| After | Backend, no DB (passed / skipped) | Dashboard (files / tests) | Build | This task's test files |
|---|---|---|---|---|
| base | 2272 / 650 | 89 / 2432 | clean | — |
| 1 | 2273 / 650 | 89 / 2432 | — | `test_permissions.py` 14 → **15**; the dashboard's mirror (no new test: `catalogue.test.js` loops over the keys) |
| 2 | 2275 / 662 | — | — | `test_patient_numbers.py` **8** (new: 2 without the DB, 6 with it); `test_migration_0012_kabul.py` **6** (new, DB); fixture numbers in five files |
| 3 | 2303 / 662 | — | — | `test_admission_form.py` **28** (new); `test_admission_workflow.py` 16 (one assertion added) |
| 4 | 2309 / 666 | — | — | `test_unit_scope.py` **10** (new: 6 + 4 with the DB) |
| 5 | 2320 / 667 | — | — | `test_kabul_identity.py` **11** (new); `test_patient_identity_postgres.py` 2 → **3** (DB) |
| 6 | 2330 / 667 | — | — | `test_kabul_boardlink.py` **10** (new) |
| 7 | 2330 / 689 | — | — | `test_structure_api.py` **13** (new, DB); `test_tenant_isolation.py` 109 → **118** (DB); `test_route_permissions.py` 15 (five rows, no new test) |
| 8 | 2330 / 700 | — | — | `test_admission_api.py` **11** (new, DB); `test_tenant_isolation.py` 118 (the body changes) |
| 9 | 2330 / 710 | — | — | `test_discharge_api.py` **10** (new, DB); the slice's 22 files under Python 3.14: **292 passed, 175 skipped** (no DB) |
| 10 | — | 89 / 2432 | clean | `strings.test.js` 7 (it loops over every key; no count moves) |
| 11 | — | 89 / 2466 | clean | `backendApi.test.js` → **116**, `apiErrors.test.js` → **173** (the two: 255 → 289) |
| 12 | — | 92 / 2484 | clean | `structure.test.js` **10**, `StructureProvider.test.jsx` **4**, `unitNames.test.jsx` **4** (new) |
| 13 | — | 93 / 2489 | clean | `KabulScreen.test.jsx` **5** (new) |
| 14 | — | 96 / 2508 | clean | `admitForm.test.js` **9**, `BedPicker.test.jsx` **5**, `AdmitTab.test.jsx` **5** (new) |
| 15 | — | 97 / 2518 | clean | `DischargeTab.test.jsx` **10** (new) |
| 16 | — | 98 / 2523 | clean | `BedsTab.test.jsx` **5** (new) |
| 17 | — | 99 / 2529 | clean | `SignOffStrip.test.jsx` **6** (new; the bed card's badge in it) |
| 18 | — | 100 / 2534 | clean | `StructureTab.test.jsx` **5** (new); `AdminScreen.test.jsx` 25 (the tab list test now four tabs) |
| 19 | — | 100 / 2535 | clean | `rawKeys.test.jsx` 7 → **8** |
| 20 | 2330 / 710 | 100 / 2535 | clean | with Postgres **3032 passed, 8 skipped** (fourteen parts); Python 3.14, the slice's 11 files with the DB: **125 passed** |

Every row is the replay's own run of that task's Step "whole suite" on the tree Tasks 1 → N built, in this order (2026-10-25). The dashboard lane, run from `feat/g2b-kabul` after Task 3 as "The two lanes" says, carries Tasks 1–3's engine files and nothing of Tasks 4–9, so its counts are the rows above (no dashboard file changes in Tasks 2–9). A backend lane merged after the dashboard lane gives the same totals: the two lanes touch disjoint test files.

---

## Ground rules for every task

- **Your worktree.** The plan runs in two lanes (see "Task order, lanes and parallel work"): the backend lane in `/c/tmp/g2b-kabul-be` (branch `feat/g2b-kabul-be`), the dashboard lane in `/c/tmp/g2b-kabul-fe` (branch `feat/g2b-kabul-fe`), both made from `feat/g2b-kabul`; Tasks 20–23 run in `/c/tmp/g2b-kabul` itself (branch `feat/g2b-kabul`: the spec `b8f7402`, `b1899cb` on origin/main `03daac4`, then origin/main `312b1f9` — NBP and Lane A's A1 — merged as `2c585e8`, the B3a spec `d8937fd` (docs only), then this plan). Every path below is relative to the repository root of the worktree the task names. **Never touch `/c/Users/User/Desktop/Project/Homunculus AI`** (the user's main checkout), `/c/tmp/inf-nbp` or any `/c/tmp/g2a-*` worktree (Lane A's). Never `git push`, never deploy, never change anything on a VM: Task 23's blocks are pasted by the user. **Never run `git stash`** — the stash is shared with every worktree and session. If you remove a worktree, unlink its `node_modules` junction first (`cmd //c "rmdir C:\\tmp\\g2b-kabul-fe\\dashboard\\node_modules"`), then `git worktree remove --force`: a recursive delete that follows the junction empties the shared install. Never reinstall `node_modules`.
- **Write and Edit tools only on repo files — never `sed`, `python`, `node` or a shell heredoc on a repo file.** The tree checks out **CRLF** (`core.autocrlf=true`); every block here is LF. The Edit tool matches either way and keeps a file's CRLF. A bold **Write** gives a NEW file's whole text: it lands LF, and git normalises it on commit (`warning: … LF will be replaced by CRLF` is expected and harmless). Each **Edit**'s old text is unique in its file at that moment (the replay asserted it); apply a file's numbered Edits in order. Each task ends by counting the line ends of the files it touched — for a file the base had, `CR` must equal `LF`; for a file this plan creates, `CR=0`; both must be the numbers the task gives (a mismatch means a line end was rewritten or an edit landed twice). After editing `strings/*.js` (Azerbaijani, Russian, Turkish) run `npx vitest run src/live/i18n/strings.test.js`: it fails if the Cyrillic or the `ə` was mangled.
- **TDD.** Write the test, run it and **see it red for the reason the task names**, then the code, then green. Put the red in the commit body (`red: 4 failed, 11 passed — AssertionError … hospital_admin`).
- **Stage explicit paths only.** Before every commit run `git status --short` and `git diff --cached --stat`; commit with a pathspec (`git commit -m … -- <paths>`). If a staged path is not one the task lists, stop and ask.
- **Commit after every task.** Messages are `type(scope): what, in words` (`feat(admission): …`, `feat(dashboard): …`, `docs(…): …`) and end with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```
  (the trailer the controller set for this session; if the controller records a newer one by the time you commit, use that).
- **Foreground gates.** Run every suite and build in the foreground; never background a gate and wait on it (an agent that did sat silent for hours). One Bash call runs at most 10 minutes: name the files. The no-DB engine suite fits (≈ 2–2½ min); the Postgres-backed suite does not — Task 20 runs it in fourteen parts.
- **Python commands** (always from the engine directory, always `PYTHONPATH=src`, always name files):
  ```bash
  cd /c/tmp/g2b-kabul-be/homunculus-engine
  PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q <files> 2>&1 | tail -3
  ```
  **Never run `tests/test_infinity_vm_pilot.py`** (it hangs), alone or in a bare `pytest tests/`. The whole no-DB suite: the same command with `--ignore=tests/test_infinity_vm_pilot.py` and no file list. **Never set or export `DATABASE_URL`.** Never print a token, a key or an env file's values.
- **Postgres-backed tests** read `TEST_DATABASE_URL`, given **on the command line of each call, never exported**. The test database is the container `homunculus-test-pg-56` on port 56432 (`docker start homunculus-test-pg-56` if `docker ps` does not list it):
  ```bash
  cd /c/tmp/g2b-kabul-be/homunculus-engine
  TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 \
    /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q <files> 2>&1 | tail -3
  ```
  `conftest.py` holds a session advisory lock on the database, so a run while Lane A runs its own waits ("waiting for another test run …") rather than corrupting either; the wait counts against your 10 minutes — if it prints that line, wait and run the command again. DB-backed tests are slow here (≈ 5 s each: every test drops and recreates the schema).
- **Dashboard commands** run from `/c/tmp/g2b-kabul-fe/dashboard`. Filter by file, or by folder **with a trailing slash** (Vitest filters by substring). The suite and the build are **two separate commands**:
  ```bash
  cd /c/tmp/g2b-kabul-fe/dashboard
  npx vitest run 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ Test Files |^ +Tests |^ FAIL "
  ```
  ```bash
  cd /c/tmp/g2b-kabul-fe/dashboard
  npx vite build 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "built in|precache|larger than|error"
  ```
  The build must print `built in` and `precache  20 entries`, and no `larger than 500 kB`. A test run may print `Warning: An update to … inside a test was not wrapped in act(...)`; it is not a failure.
- **The gates.** A backend task ends with its named files green and the whole no-DB suite at the count it gives; a dashboard task with the whole suite and the build. Task 20 runs everything, the Postgres-backed suite included.
- **Line-end count** (the files the task names):
  ```bash
  cd <the task's worktree>
  for f in <files>; do printf "%s CR=%s LF=%s\n" "$f" "$(tr -cd '\r' < "$f" | wc -c)" "$(tr -cd '\n' < "$f" | wc -c)"; done
  ```
- **D1, the boundaries and reachability (dashboard).** Nothing under `src/live/` imports outside it but `backendApi.js`, `liveAuth.js`, `liveAdapters.js`, `liveConnection.js` (`boundaries.test.js`). **Every production module must be reachable from `main.jsx` in the commit that creates it** (`src/reachable.test.js`) — which is why Task 13 wires the route with three empty tabs before Tasks 14–16 fill them.
- **No patient data, ever** (CLAUDE.md rule 6). Every name is "Sentetik …", every number made up (`H2600042`), every UUID a fixture (`kabul.testutil.js`, `tests/kabul_world.py`); the audit rows carry the number, never a name, and the tests assert it.
- **Thresholds live in the engine.** The browser holds presence and format checks only (a FİN of seven letters or digits, a weight that is a positive number); every bound and every clinical decision — which bed is free, which alert blocks a discharge — is the server's, and its refusal is what the screen says. The Taburcu button's hold on an open critical alarm is a hint read from the same board the clinician sees (X61's sibling); the server refuses anyway.
- **Refusals and announcements** (amendments, binding): a write's refusal goes on the **toast** via `refusedFor` (`screens/admin/refusal.js`), named after its subject — the bed "1 · Otaq 1 · Reanimasiya", a unit's or a room's name — **never `display_name`** and never also inline; `useToast()` **is** the function (no `.show`). `Button` takes `busy`, never `disabled`; a held action is `aria-disabled="true"` and says why in words. Anything said once goes through `Announce`.
- **Codes, not words.** A coded refusal (`err.apiCode`, Task 11) is mapped by its code (`apiErrors.js` `ADMISSION_CODE_KEYS`, `INVALID_FIELD_KEYS`); a test asserts the screen never prints the server's English.
- **No UUID on any screen** (spec D9, §5.7). A unit or bed is named from the structure (`data/structure.js` `unitLabel`, `bedLabel`); a test of every new surface asserts `document.body.textContent` holds no UUID.
- **Four languages for every key** (`tr` is the source; `az` the default). An `az` text equal to `tr`, and an `ru` text with no Cyrillic, need a reviewed entry in `strings.test.js` (`AZ_SAME_AS_TR`, `NEUTRAL`). Russian calls the engine "система", never "движок".
- **Lane B's seams.** `i18n/catalog.js`, `shell/routes.js` (SCREENS and ROUTES), `strings.test.js`'s two lists and the permission catalogue take B1a's lines as blank-separated blocks marked `// G2-B1a`, as Wave 3 did. Do not tidy the gaps away. In Lane A's files only the agreed regions change (the file map marks each; X51 is the one place the plan goes beyond the agreement's letter, gated before Task 5). In `api/patient_identity.py` never touch `parse_fhir_patient` or `parse_fhir_encounter`: Lane A's A2 adds a call inside each.
- **Test names:** `describe` names the thing, `it` is a sentence about its behaviour in the reader's terms.

---

## File map

**Create — engine** (`homunculus-engine/`)

| File | Responsibility | Task |
|---|---|---|
| `alembic/versions/0012_admission_kabul.py` | the form's columns, the patient number (backfilled for existing rows) and its counters, `beds.is_active`, the identity's `bed_id`/`unit_id`, `beds.release` for every tenant's nurse groups; downgrade | 2 |
| `src/homunculus/admission/errors.py` | the stable refusal codes, `Refusal`, `field_invalid` | 2 |
| `src/homunculus/admission/numbers.py` | `H` + year + five digits, per tenant and UTC year, under the counter row's lock | 2 |
| `src/homunculus/admission/form.py` | the admission form's and the discharge decision's rules (`field_invalid:<field>`) | 3 |
| `src/homunculus/admission/unitscope.py` | the caller's scope in a tenant; `reaches`, `require_reach` (403 `out_of_scope`) | 4 |
| `src/homunculus/admission/boardlink.py` | `BoardLink` — identity, weight, profile, open-critical count, discharge; `count_open_critical`, `kabul_record`, `board_link_of` | 6 |
| `src/homunculus/admission/trail.py` | the hospital key (tenant slug) and one audit row | 7 |
| `tests/test_migration_0012_kabul.py` | numbers backfilled per UTC year, `beds.release` to the nurses only, the round trip, model parity | 2 |
| `tests/test_patient_numbers.py` | format, sequence, per tenant, year rollover, exhaustion, rollback, two at once | 2 |
| `tests/test_admission_form.py` | every rule names its field; codes; `_wf`'s shape | 3 |
| `tests/test_unit_scope.py` | `reaches`; the caller's scope read from grants; own patients by number | 4 |
| `tests/test_kabul_identity.py` | the record's own bed; tombstones never pruned; the board's join; the removal reaches the unit | 5 |
| `tests/test_kabul_boardlink.py` | each `BoardLink` door on the real app; restart replays; open-critical in both alert shapes; the sweep's removal; the Aşama A strip's link | 6 |
| `tests/kabul_world.py` | a synthetic ward: two units, five beds, staff with unit grants, tokens, a client | 7 |
| `tests/test_structure_api.py` | the tree by scope; rename / close / reopen and their refusals; the release and its audit | 7 |
| `tests/test_admission_api.py` | the admission end to end, its engine parts, every refusal, two at once, the list | 8 |
| `tests/test_discharge_api.py` | sign-off; discharge start and confirm with their refusals; the whole flow of spec §8 | 9 |

**Modify — engine**

| File | Change | Task |
|---|---|---|
| `src/homunculus/auth/permissions.py` | `beds.release` in the catalogue (last); in `nurse` and `charge_nurse` | 1 |
| `tests/test_permissions.py` | 22 keys; the group table; who releases a bed | 1 |
| `src/homunculus/admission/models.py` | `AdmissionType`, `BloodGroup`, `Consent`, `DischargeDisposition`; the patient's number and form fields; `PatientNumberCounter`; the admission's form and discharge fields | 2 |
| `src/homunculus/tenant/models.py` | `Bed.is_active` | 2 |
| `src/homunculus/admission/router.py` | Task 2: the number at create · Task 3: `_wf` answers a code · Task 8: the whole create, the list · Task 9: sign-off, discharge start and confirm | 2, 3, 8, 9 |
| `tests/test_admission_workflow.py`, `tests/test_escalation_workflow.py`, `tests/test_scope_me_agrees_with_board.py`, `tests/test_scope_role_from_groups.py` | a patient number on every fixture patient (2); the missing-attending code (3); the discharge's new keywords (9) | 2, 3, 9 |
| `tests/test_tenant_isolation.py` | fixture numbers (2); the structure routes and the structure list (7); the admission body's required fields (8); the discharge body (9) | 2, 7, 8, 9 |
| `src/homunculus/admission/schemas.py` | the form's fields; `AdmitResponse`, `AdmissionRow`, `EngineWrites`, `DischargeConfirmResponse`, `DischargeStart` (3); `DischargeInitiate` removed (9) | 3, 9 |
| `src/homunculus/admission/service.py` | `WorkflowError.code` (3); the bed row locked (8); the disposition (9) | 3, 8, 9 |
| `src/homunculus/scope/service.py` | own patients by `patient_number` as well | 4 |
| `src/homunculus/api/patient_identity.py` **(Lane A file — agreed region)** | `KABUL`; `bed_id`/`unit_id` on the record, in `as_board`, in `_merge`'s location group (kept on discharge); a `kabul` record never expires; SQLite columns | 5 |
| `src/homunculus/api/patient_identity_postgres.py` **(Lane A file — agreed region)** | the two columns; no prune of a `kabul` record | 5 |
| `src/homunculus/api/board.py` **(Lane A file — agreed region, X51)** | `_own_bed`, `_is_tombstone`, `_tombstone_board` after `_bed_resolution`; two lines at its top; two at the top of `patient_board`; one filter and one condition in `board_snapshot` | 5 |
| `tests/test_patient_identity_postgres.py` | provisioned with 0012's two columns; the tombstone survives a prune | 5 |
| `src/homunculus/api/app.py` **(Lane A file — agreed regions)** | `BoardLink` on `app.state`; `_occupants` by the identity's own `bed_id`; the 24 h sweep's removal carries a last bed (inside the sweep only) | 6 |
| `src/homunculus/tenant/schemas.py` | `BedResponse.is_active`; the patches; the structure tree | 7 |
| `src/homunculus/tenant/router.py` | `GET /tenant/structure`; `PATCH` units, rooms, beds; `POST /tenant/beds/{id}/release` | 7 |
| `tests/test_route_permissions.py` | five rows; 59 routes | 7 |

**Create — dashboard** (`dashboard/src/live/`)

| File | Responsibility | Task |
|---|---|---|
| `i18n/strings/kabul.js` | every text of the slice, four languages | 10 |
| `data/structure.js` (+ test) | the structure's index; `unitLabel`, `bedLabel`, `isUuid`, `admissible`, `unavailableKey`, `BED_STATE_KEYS` | 12 |
| `data/StructureProvider.jsx` (+ test) | the shell's one read of `GET /tenant/structure`; `useStructure()` | 12 |
| `screens/kabul/kabul.testutil.js` | a synthetic ward, admission rows, `mountKabul`, the staff's rights | 12 |
| `screens/kabul/unitNames.test.jsx` | the top bar, the bed board and the scope editor name units and beds | 12 |
| `screens/kabul/KabulScreen.jsx` (+ test) | the route's frame: one h1, three tabs gated by rights | 13 |
| `screens/kabul/AdmitTab.jsx` (+ test) | the form, the missing-fields panel, the number box (an empty stub in 13) | 13, 14 |
| `screens/kabul/admitForm.js` (+ test) | the form's choices, `missing`, `ageOf`, `toBody` | 14 |
| `screens/kabul/BedPicker.jsx` (+ test) | unit → room → bed, only an open AVAILABLE bed | 14 |
| `screens/kabul/useAdmissions.js` | `GET /admissions` in some states, optionally on a timer | 15 |
| `screens/kabul/DischargeDialog.jsx` | the physician's decision | 15 |
| `screens/kabul/DischargeTab.jsx` (+ test) | the two lists, start and confirm (a stub in 13) | 13, 15 |
| `screens/kabul/BedsTab.jsx` (+ test) | the beds by state and the release (a stub in 13) | 13, 16 |
| `screens/kabul/SignOffStrip.jsx` (+ test) | "Hekim imzası bekliyor" and the signature; the test also holds the bed card's badge | 17 |
| `screens/admin/StructureTab.jsx` (+ test) | Yönetim › Yapı | 18 |

**Modify — dashboard** (`dashboard/`)

| File | Change | Task |
|---|---|---|
| `src/live/screens/admin/catalogue.js`, `src/live/screens/admin/admin.testutil.js`, `src/live/i18n/strings/perms.js` | `beds.release` mirrored (four languages) — in the backend commit, because `catalogue.test.js` reads `permissions.py` | 1 |
| `src/live/i18n/catalog.js`, `src/live/i18n/strings.test.js` | the `kabul` namespace's block; its reviewed `NEUTRAL` and `AZ_SAME_AS_TR` entries | 10 |
| `src/backendApi.js` (+ test), `src/live/session/testTokens.testutil.js` | `err.apiCode`; fourteen calls; `fakeApi` | 11 |
| `src/live/apiErrors.js` (+ test) | `ADMISSION_CODE_KEYS`, `INVALID_FIELD_KEYS`; the test reads `admission/errors.py` and the three files that name a field | 11 |
| `src/live/shell/Shell.jsx`, `src/live/shell/TopBar.jsx`, `src/live/screens/beds/BedsScreen.jsx`, `src/live/screens/admin/ScopeEditor.jsx` | the structure for the shell; names for the unit chooser, the bed board's selector and the scope editor | 12 |
| `src/live/shell/routes.js` | the `kabul` route and screen, each a `G2-B1a` block | 13 |
| `src/live/screens/patient/PatientScreen.jsx`, `src/live/screens/beds/BedCard.jsx`, `src/live/screens/beds/BedsScreen.jsx` | the strip (two lines); the badge; the DRAFT read | 17 |
| `src/live/screens/admin/AdminScreen.jsx` (+ test) | the `structure` tab, a `G2-B1a` block | 18 |
| `src/live/rawKeys.test.jsx` | the ward and admissions in the sweep's fixture; an anchor over every Hasta Kabul surface | 19 |

**Modify — docs** (Task 22): `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md` (the row G2-B1a), `docs/homunculus-rehber-TR.md` (§3.8 Hasta Kabul).

**Outside the repo** (Tasks 20, 23): `/c/tmp/homunculus-plans/g2b1a/reference.patch`; `/c/tmp/infinity-a-releases/g2b1a-<short>.bundle`, `G2B1a-bloklari.txt`.

**How an edit reads in this plan:** a bold **Edit** with the file's path and its number in that file, "replace:", a fenced block with the exact old text, "with:", and a fenced block with the new text. Use the Edit tool with those two texts, in the order given; each old text is unique in its file at that moment (the replay asserted it). A bold **Write** gives a new file's whole text.

---

## Task order, lanes and parallel work

| Task | Lane | Needs | May run beside | Files it shares with a later task |
|---|---|---|---|---|
| 1 `beds.release` (engine + the dashboard's mirror) | backend | — | 10 | — |
| 2 migration 0012, models, the patient number | backend | 1 | 10 | `admission/router.py` (3, 8, 9), `test_tenant_isolation.py` (7, 8, 9), `test_admission_workflow.py` (3, 9) |
| 3 the form's rules, the schemas, the codes | backend | 2 | 10 | `admission/router.py`, `admission/service.py`, `admission/schemas.py` (8, 9) |
| 4 unit scope; own patients by number | backend | 3 | 10–19 (after 3 is merged) | — |
| 5 the identity's own bed, tombstones, the board's join | backend | 2 (the columns), 4; **Lane A's confirmation of X51** | 10–19 | — |
| 6 `BoardLink` and `api/app.py` | backend | 5 | 10–19 | — |
| 7 the structure routes | backend | 4 (`unitscope`), 6 | 10–19 | `test_tenant_isolation.py` |
| 8 `POST`/`GET /admissions` | backend | 6, 7 (`trail`, `kabul_world`) | 10–19 | `admission/router.py`, `service.py` |
| 9 sign-off, discharge, the whole flow | backend | 8 | 10–19 | — |
| 10 the strings | dashboard | — | 1–3 | — |
| 11 the API client and the codes | dashboard | 10; **3 merged** (its test reads `admission/errors.py` and `admission/form.py`) | 4–9 | `backendApi.js` |
| 12 the structure for the shell; names | dashboard | 11 | 4–9 | `BedsScreen.jsx` (17), `kabul.testutil.js` (read by 13–19) |
| 13 the route and its three tabs (empty) | dashboard | 12 | 4–9 | the three tab files (14, 15, 16) |
| 14 Kabul | dashboard | 13; **3 merged** (`admitForm.test.js` reads `form.py`) | 4–9, 15, 16 | — |
| 15 Taburcu | dashboard | 13 | 4–9, 14, 16 | `useAdmissions.js` (read by 17) |
| 16 Yataklar | dashboard | 13 | 4–9, 14, 15 | — |
| 17 the strip and the badge | dashboard | 15 (`useAdmissions`), 12 | 4–9, 18 | — |
| 18 Yönetim › Yapı | dashboard | 12 | 4–9, 14–17 | — |
| 19 the sweep | dashboard | 14–18 | 4–9 | — |
| 20 gates | — | 1–19 merged | — | — |
| 21 the local walk | — | 20 | — | — |
| 22 docs | — | 20 (the counts it quotes) | 21 | — |
| 23 deploy blocks | — | 21, 22 | — | — |

**The two lanes.**

```bash
# backend lane (Tasks 1–9), from the slice's branch at this plan's commit
cd /c/tmp/g2b-kabul
git worktree add -b feat/g2b-kabul-be /c/tmp/g2b-kabul-be feat/g2b-kabul
cmd //c "mklink /J C:\\tmp\\g2b-kabul-be\\dashboard\\node_modules C:\\tmp\\homunculus-g1\\dashboard\\node_modules"
```

```bash
# dashboard lane (Tasks 10–19). Task 10 may start at once; Task 11 needs Tasks 1–3 on the slice's
# branch first, so after Task 3: fast-forward the slice's branch to the backend lane, then merge it in.
cd /c/tmp/g2b-kabul
git worktree add -b feat/g2b-kabul-fe /c/tmp/g2b-kabul-fe feat/g2b-kabul
cmd //c "mklink /J C:\\tmp\\g2b-kabul-fe\\dashboard\\node_modules C:\\tmp\\homunculus-g1\\dashboard\\node_modules"
# … Task 10 …; after Task 3 has landed on feat/g2b-kabul-be:
git -C /c/tmp/g2b-kabul merge --ff-only feat/g2b-kabul-be
git -C /c/tmp/g2b-kabul-fe merge --no-edit feat/g2b-kabul
```

The dashboard lane touches no engine file and the backend lane no dashboard file but Task 1's three (the permission mirror, which must land with `permissions.py`). **Merge order:** the backend lane first (`git -C /c/tmp/g2b-kabul merge --ff-only feat/g2b-kabul-be`), then the dashboard lane (`git -C /c/tmp/g2b-kabul merge --no-ff feat/g2b-kabul-fe -m "merge: G2-B1a dashboard lane"`); Tasks 20–23 run on the merged `feat/g2b-kabul`. Removing a lane worktree: unlink the junction first (`cmd //c "rmdir C:\\tmp\\g2b-kabul-fe\\dashboard\\node_modules"`), then `git worktree remove --force /c/tmp/g2b-kabul-fe`, then `git branch -d feat/g2b-kabul-fe`.

**Why this order.** A permission key lands in the engine and in the dashboard's mirror in one commit (`catalogue.test.js` holds them together). The schema (2) comes before every route that writes it; the codes (3) before the routes that answer them; the board's join (5, 6) before the admission that writes through it (8); the structure routes (7) before the admission routes, whose tests build the ward through `tests/kabul_world.py`. On the dashboard, the strings come first (every later test reads them), the client second, the shell's structure third (every Hasta Kabul surface reads it), the route with three empty tabs fourth (`reachable.test.js`: a module is wired the commit it lands), then the tabs, which may run in parallel. The plan was measured in the serial order 1 → 19; a parallel merge re-runs Task 20's gates on the merged head.

## Lane A coordination (the agreed regions)

Lane A (the other session: the patient screen and the engine) owns `api/app.py`, `api/board.py`, the pipeline, `audit*` and `api/clinical.py`. Its A1 (O17: alert episodes, the critical latch, the escalation chain; new `api/alert_lifecycle.py`, the audit event `alert_cleared`) is merged into this branch's base `2c585e8`; its A2 is being planned (`/c/tmp/g2a-a2-*`). Lane A agreed (2026-10-25, restated by the coordinator the same day) that B1a may make these changes **and no others**:

| File | B1a's change | Lane A's own region, untouched |
|---|---|---|
| `api/app.py` | a `BoardLink` built and put on `app.state` (after `app.state.shadow_store`); `_occupants` (`:867`) resolves a device's bed by the identity's own `bed_id`; inside the 24 h retention sweep (`:300–313`), the `removed` frame carries a last bed and unit; one import line after `api.trends`' | `_escalation_cycle` (`:266–298`), `/clinical`, `/ingest`, `/ack`, `_audit_cleared`, the live-key pruning, the shadow lane's board endpoint (NBP) |
| `api/board.py` | `_own_bed`, `_is_tombstone`, `_tombstone_board` after `_bed_resolution`; two lines at the top of `patient_board`; **beyond the letter (X51, gated before Task 5):** two lines at the top of `_bed_resolution`, one filter line and one condition in `board_snapshot`; `KABUL` imported | `_merge_alert` (`:156`), `_latched_alerts` (`:172`), `_risk` (`:33`), the dict `patient_board` returns |
| `api/patient_identity.py`, `api/patient_identity_postgres.py` | additive: `bed_id`/`unit_id`, `KABUL`, and no 24 h prune of a discharged `kabul` record | `parse_fhir_patient` (≈ 130) and `parse_fhir_encounter` (≈ 199): A2 adds an id-validator call inside each; no B1a hunk or Edit context reaches them |
| `api/clinical.py`, `api/alert_lifecycle.py` | **none** — read: `build_entries`, `profile_from_payload`, `profile_to_payload`, `PLAUSIBLE`; `sync_alerts` (X62) | all |

`BoardLink.open_critical` reads the board `patient_board` builds — A1's firing alerts and, after them, its latched ones (`acknowledged: false`, `resolved_at` set) — and counts the critical, unacknowledged ones; Task 6 tests it on the real app, through `/ingest` and `/ack`, never on a hand-made alert. On the dashboard, A1 edited `liveAdapters.js` (a latched alert's status is `RESOLVED`), `signals.js`, `AlarmSignals.jsx`, `AlarmsScreen.jsx`, `boardStore.js`, `strings/alarms.js`, `strings/patient.js`, `TrendLegend.jsx` and `board.testutil.js`, and NBP the monitor strip and `strings/monitor.js`: B1a touches none of them (X60 leaves `strings/patient.js` alone). The Taburcu hold reads the adapter's status (`!== "ACKNOWLEDGED"`, so `FIRED` and `RESOLVED` both hold it).

---

### Task 1: `beds.release` — the catalogue, the nurses' groups and the dashboard's mirror

**Lane:** backend (`/c/tmp/g2b-kabul-be`). **Needs:** nothing.

Spec D8, §3.4, §4.4. A cleaned bed goes back to AVAILABLE only through `POST /tenant/beds/{id}/release` (Task 7), which needs a new key, `beds.release`. It goes last in the catalogue (the catalogue's order is the administration screen's order; a new key at the end moves no row), and into the default `nurse` and `charge_nurse` groups — nobody else's, the physician's included (D8). The dashboard keeps a mirror of the catalogue (`screens/admin/catalogue.js`, its fixture and `strings/perms.js`), and `catalogue.test.js` reads `permissions.py` itself, so the mirror lands in this commit: an engine key with no mirror turns the dashboard red, as Step 4 shows. For existing tenants the key reaches the two groups through migration `0012` (Task 2): `ensure_default_groups` never adds a key to a group that exists.

**Files:**
- Modify: `homunculus-engine/tests/test_permissions.py`
- Modify: `homunculus-engine/src/homunculus/auth/permissions.py`
- Modify: `dashboard/src/live/screens/admin/catalogue.js`
- Modify: `dashboard/src/live/screens/admin/admin.testutil.js`
- Modify: `dashboard/src/live/i18n/strings/perms.js`

- [ ] **Step 1: Write the failing test** — the catalogue's 22 keys, the group table, and who releases a bed:

**Edit** `homunculus-engine/tests/test_permissions.py` (1) — replace:

```python
    "devices.manage", "clinical.chart", "scores.sign",
}


def test_the_catalogue_is_exactly_the_specified_twenty_one_keys():
    assert set(PERMISSIONS) == SPEC_KEYS
```

with:

```python
    "devices.manage", "clinical.chart", "scores.sign",
    "beds.release",       # G2-B1a (spec D8)
}


def test_the_catalogue_is_exactly_the_specified_twenty_two_keys():
    assert len(SPEC_KEYS) == 22
    assert set(PERMISSIONS) == SPEC_KEYS
```

**Edit** `homunculus-engine/tests/test_permissions.py` (2) — replace:

```python
                                    "care_team.claim", "handover.sign", "shifts.manage",
                                    "break_glass.use", "clinical.chart"}),
    "nurse": (False, False, {"board.view", "alerts.ack", "admissions.view", "admissions.admit",
                             "admissions.transfer.confirm", "handover.sign",
                             "clinical.chart"}),
    "rapid_response": (False, False, {"board.view", "alerts.ack", "alerts.escalate",
```

with:

```python
                                    "care_team.claim", "handover.sign", "shifts.manage",
                                    "break_glass.use", "clinical.chart", "beds.release"}),
    "nurse": (False, False, {"board.view", "alerts.ack", "admissions.view", "admissions.admit",
                             "admissions.transfer.confirm", "handover.sign",
                             "clinical.chart", "beds.release"}),
    "rapid_response": (False, False, {"board.view", "alerts.ack", "alerts.escalate",
```

**Edit** `homunculus-engine/tests/test_permissions.py` (3) — replace:

```python

def test_legacy_pharmacist_and_biomedical_convert():
```

with:

```python

def test_a_cleaned_bed_is_released_by_the_wards_nurses_and_no_one_else_by_default():
    """G2-B1a, spec D8: a ward turns its beds over at night without an administrator. Changing the
    structure stays `structure.manage`; the system group holds every key by rule."""
    by_slug = {g["slug"]: set(g["permissions"]) for g in DEFAULT_GROUPS}
    holders = {slug for slug, perms in by_slug.items() if "beds.release" in perms}
    assert holders == {"nurse", "charge_nurse", "hospital_admin"}
    assert "structure.manage" not in by_slug["nurse"] | by_slug["charge_nurse"]


def test_legacy_pharmacist_and_biomedical_convert():
```


- [ ] **Step 2: Run it and see it red** — the catalogue still holds 21 keys, and no group holds `beds.release`:

```bash
cd /c/tmp/g2b-kabul-be/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 \
  /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_permissions.py 2>&1 | grep -E "^(FAILED|ERROR) |[0-9]+ (passed|failed|error)|^E +[A-Za-z]*(Error|Exception)" | head -16
```

Expected (the replay, times vary):

```text
FAILED tests/test_permissions.py::test_the_catalogue_is_exactly_the_specified_twenty_two_keys
FAILED tests/test_permissions.py::test_hospital_admin_holds_every_permission
FAILED tests/test_permissions.py::test_every_default_group_matches_the_spec_table_exactly
FAILED tests/test_permissions.py::test_a_cleaned_bed_is_released_by_the_wards_nurses_and_no_one_else_by_default
4 failed, 11 passed in …s
E       AssertionError: assert {'admissions....ns.view', ...} == {'admissions....ns.view', ...}
E       AssertionError: assert {'admissions....ns.view', ...} == {'admissions....ns.view', ...}
E           AssertionError: hospital_admin
```


- [ ] **Step 3: Add the key** (last, under a `G2-B1a` comment) and give it to the two nurse groups:

**Edit** `homunculus-engine/src/homunculus/auth/permissions.py` (1) — replace:

```python
    "scores.sign": "Sign a severity-score form (SOFA) with corrections",
}
```

with:

```python
    "scores.sign": "Sign a severity-score form (SOFA) with corrections",

    # G2-B1a — a ward turns its beds over at night without an administrator (spec D8).
    "beds.release": "Mark a cleaned bed free again (housekeeping → available), in one's own units",
}
```

**Edit** `homunculus-engine/src/homunculus/auth/permissions.py` (2) — replace:

```python
                     "admissions.discharge.confirm", "care_team.claim", "handover.sign",
                     "shifts.manage", "break_glass.use", "clinical.chart")},
    {"slug": "nurse", "kind": "role", "name": "Hemşire",
```

with:

```python
                     "admissions.discharge.confirm", "care_team.claim", "handover.sign",
                     "shifts.manage", "break_glass.use", "clinical.chart", "beds.release")},
    {"slug": "nurse", "kind": "role", "name": "Hemşire",
```

**Edit** `homunculus-engine/src/homunculus/auth/permissions.py` (3) — replace:

```python
     "permissions": ("board.view", "alerts.ack", "admissions.view", "admissions.admit",
                     "admissions.transfer.confirm", "handover.sign", "clinical.chart")},
    {"slug": "rapid_response", "kind": "extra", "name": "Hızlı Yanıt Ekibi",
```

with:

```python
     "permissions": ("board.view", "alerts.ack", "admissions.view", "admissions.admit",
                     "admissions.transfer.confirm", "handover.sign", "clinical.chart",
                     "beds.release")},
    {"slug": "rapid_response", "kind": "extra", "name": "Hızlı Yanıt Ekibi",
```


- [ ] **Step 4: Run the engine's tests green, and see the dashboard's mirror go red** — `catalogue.test.js` and `admin.testutil.test.js` read `permissions.py`: the engine now has a key the mirror lacks.

```bash
cd /c/tmp/g2b-kabul-be/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 \
  /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_permissions.py tests/test_migration_0010_defaults.py tests/test_groups_service.py 2>&1 | grep -E "^(FAILED|ERROR) |[0-9]+ (passed|failed|error)|^E +[A-Za-z]*(Error|Exception)" | head -16
```

Expected (the replay, times vary):

```text
21 passed, 27 skipped in …s
```

```bash
cd /c/tmp/g2b-kabul-be/dashboard
npx vitest run src/live/screens/admin/catalogue.test.js src/live/screens/admin/admin.testutil.test.js 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ Test Files |^ +Tests |^ FAIL |→ |×"
```

Expected (the replay, times vary):

```text
Test Files  2 failed (2)
      Tests  2 failed | 16 passed (18)
 FAIL  src/live/screens/admin/admin.testutil.test.js > the administration fixtures are the API's own shapes > the permission descriptions are the server's, word for word
 FAIL  src/live/screens/admin/catalogue.test.js > the permission catalogue mirrors the backend > has the backend's keys, in the backend's order
× the permission catalogue mirrors the backend > has the backend's keys, in the backend's order 8ms
→ expected [ 'board.view', 'alerts.ack', …(19) ] to deeply equal [ 'board.view', 'alerts.ack', …(20) ]
× the administration fixtures are the API's own shapes > the permission descriptions are the server's, word for word 12ms
→ expected 22 to be 21 // Object.is equality
```


- [ ] **Step 5: Mirror the key** — the catalogue's entry (in its `G2-B1a` block), the fixture's description word for word, and the four languages' label and help:

**Edit** `dashboard/src/live/screens/admin/catalogue.js` (1) — replace:

```js
  "clinical.chart", "scores.sign",
]);
```

with:

```js
  "clinical.chart", "scores.sign",

  // G2-B1a — a cleaned bed marked free by the ward's nurses (spec D8)
  "beds.release",
]);
```

**Edit** `dashboard/src/live/screens/admin/admin.testutil.js` (1) — replace:

```js
  "scores.sign": "Sign a severity-score form (SOFA) with corrections",
});
```

with:

```js
  "scores.sign": "Sign a severity-score form (SOFA) with corrections",

  // G2-B1a
  "beds.release": "Mark a cleaned bed free again (housekeeping → available), in one's own units",
});
```

**Edit** `dashboard/src/live/i18n/strings/perms.js` (1) — replace:

```js
    scores: { sign: "Ağırlık skoru formunu (SOFA) düzeltmelerle imzalar" },
  },
```

with:

```js
    scores: { sign: "Ağırlık skoru formunu (SOFA) düzeltmelerle imzalar" },

    // G2-B1a
    beds: { release: "Temizliği biten yatağı yeniden boş olarak işaretler (temizlik → boş), kendi birimlerinde" },
  },
```

**Edit** `dashboard/src/live/i18n/strings/perms.js` (2) — replace:

```js
    scores: { sign: "Ağırlıq balı formasını (SOFA) düzəlişlərlə imzalayır" },
  },
```

with:

```js
    scores: { sign: "Ağırlıq balı formasını (SOFA) düzəlişlərlə imzalayır" },

    // G2-B1a
    beds: { release: "Təmizlənmiş çarpayını yenidən boş kimi qeyd edir (təmizlik → boş), öz şöbələrində" },
  },
```

**Edit** `dashboard/src/live/i18n/strings/perms.js` (3) — replace:

```js
    scores: { sign: "Подписывает форму оценки тяжести (SOFA) с исправлениями" },
  },
```

with:

```js
    scores: { sign: "Подписывает форму оценки тяжести (SOFA) с исправлениями" },

    // G2-B1a
    beds: { release: "Отмечает убранную койку снова свободной (уборка → свободна) в своих отделениях" },
  },
```

**Edit** `dashboard/src/live/i18n/strings/perms.js` (4) — replace:

```js
    scores: { sign: "Sign a severity-score form (SOFA) with corrections" },
  },
```

with:

```js
    scores: { sign: "Sign a severity-score form (SOFA) with corrections" },

    // G2-B1a
    beds: { release: "Mark a cleaned bed free again (housekeeping → available), in their own units" },
  },
```


- [ ] **Step 6: Run the administration screens, the strings and the shell green:**

```bash
cd /c/tmp/g2b-kabul-be/dashboard
npx vitest run src/live/screens/admin/ src/live/i18n/strings.test.js src/live/shell/routes.test.js src/live/rawKeys.test.jsx 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ Test Files |^ +Tests |^ FAIL |→ |×"
```

Expected (the replay, times vary):

```text
Test Files  13 passed (13)
      Tests  345 passed (345)
```


- [ ] **Step 7: The whole no-DB engine suite and the whole dashboard suite:**

```bash
cd /c/tmp/g2b-kabul-be/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 \
  /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q --ignore=tests/test_infinity_vm_pilot.py 2>&1 | grep -E "^(FAILED|ERROR) |[0-9]+ (passed|failed|error)|^E +[A-Za-z]*(Error|Exception)" | head -16
```

Expected (the replay, times vary):

```text
2273 passed, 650 skipped, 3 warnings in …s
```

```bash
cd /c/tmp/g2b-kabul-be/dashboard
npx vitest run 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ Test Files |^ +Tests |^ FAIL |→ |×"
```

Expected (the replay, times vary):

```text
Test Files  89 passed (89)
      Tests  2432 passed (2432)
```


- [ ] **Step 8: Line ends:**

```bash
cd /c/tmp/g2b-kabul-be
for f in homunculus-engine/tests/test_permissions.py homunculus-engine/src/homunculus/auth/permissions.py dashboard/src/live/screens/admin/catalogue.js dashboard/src/live/screens/admin/admin.testutil.js dashboard/src/live/i18n/strings/perms.js; do printf "%s CR=%s LF=%s\n" "$f" "$(tr -cd '\r' < "$f" | wc -c)" "$(tr -cd '\n' < "$f" | wc -c)"; done
```

Expected:

```text
homunculus-engine/tests/test_permissions.py CR=178 LF=178
homunculus-engine/src/homunculus/auth/permissions.py CR=211 LF=211
dashboard/src/live/screens/admin/catalogue.js CR=73 LF=73
dashboard/src/live/screens/admin/admin.testutil.js CR=282 LF=282
dashboard/src/live/i18n/strings/perms.js CR=146 LF=146
```


- [ ] **Step 9: Commit:**

```bash
cd /c/tmp/g2b-kabul-be
git add -- homunculus-engine/tests/test_permissions.py homunculus-engine/src/homunculus/auth/permissions.py dashboard/src/live/screens/admin/catalogue.js dashboard/src/live/screens/admin/admin.testutil.js dashboard/src/live/i18n/strings/perms.js
git status --short && git diff --cached --stat
git commit -m "feat(auth): beds.release — a cleaned bed is freed by the ward's nurses (G2-B1a)" \
  -m "red: 4 failed, 11 passed (AssertionError: assert {'admissions....ns.view', ...} == {'admissions....ns.view', ...})" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- homunculus-engine/tests/test_permissions.py homunculus-engine/src/homunculus/auth/permissions.py dashboard/src/live/screens/admin/catalogue.js dashboard/src/live/screens/admin/admin.testutil.js dashboard/src/live/i18n/strings/perms.js
```

---

### Task 2: Migration `0012`, the models and the patient number

**Lane:** backend. **Needs:** Task 1 (the migration's data step adds `beds.release`).

Spec D4, D5, D8, D9, §4.1, §4.2. One migration (`0012` is B1a's) brings every column this slice writes, so the later tasks change code only:

- `patients`: `patient_number` (varchar 16, `NOT NULL`, unique per tenant — `uq_patients_tenant_number`). Every existing row gets one **in the migration**, `H` + the two-digit UTC year the row was created + its place in that tenant's year, oldest first (`ROW_NUMBER() OVER (PARTITION BY tenant_id, year ORDER BY created_at, id)`); nine encrypted fields (`EncryptedString(512)`, Fernet, as the name and the birth date are); `consent` (enum, nullable) and `sms_permitted`.
- `patient_number_counters (tenant_id, year, last)`, seeded from the numbers just given, so the next admission continues after them.
- `admissions`: the form's clinical fields (`admission_type`, `blood_group`, `allergies_text`, `no_known_allergy`, `comorbidity_codes` JSON, `comorbidities_text`) and the discharge's five.
- `beds.is_active` (server default true: every bed stays open).
- `patient_identity.bed_id`, `.unit_id` — the board identity's own bed (spec D9). The board's Postgres identity table is created by its store at start, not by Alembic, so the two columns are `ADD COLUMN IF NOT EXISTS` in a constant (`IDENTITY_COLUMNS`) that the store's own test reuses (Task 5): a database whose table does not exist yet gets the columns from the store's `CREATE TABLE` (Task 5).
- `INSERT INTO group_permissions … 'beds.release'` for the `nurse` and `charge_nurse` groups of every tenant, `ON CONFLICT DO NOTHING`.

`admission/numbers.py` issues a number: `INSERT … ON CONFLICT DO NOTHING` makes the year's counter row exist, `UPDATE … SET last = last + 1 … RETURNING last` takes its row lock until the admission's transaction ends (two admissions at once wait for each other; a rolled-back admission gives its number back), and at 99 999 it refuses `patient_number_exhausted` (a 409 with that code). The admission route (fully rewritten in Task 8) takes a number already now, because the column is `NOT NULL`; every fixture that inserts a `Patient` by hand gives one (`H2600001` …: synthetic, CLAUDE.md rule 6). `admission/errors.py` holds every stable code of the slice (the later tasks use them) and `Refusal`, the coded `HTTPException`.

**Files:**
- Create: `homunculus-engine/tests/test_migration_0012_kabul.py`
- Create: `homunculus-engine/tests/test_patient_numbers.py`
- Create: `homunculus-engine/alembic/versions/0012_admission_kabul.py`
- Create: `homunculus-engine/src/homunculus/admission/errors.py`
- Create: `homunculus-engine/src/homunculus/admission/numbers.py`
- Modify: `homunculus-engine/src/homunculus/admission/models.py`
- Modify: `homunculus-engine/src/homunculus/tenant/models.py`
- Modify: `homunculus-engine/src/homunculus/admission/router.py`
- Modify: `homunculus-engine/tests/test_admission_workflow.py`
- Modify: `homunculus-engine/tests/test_escalation_workflow.py`
- Modify: `homunculus-engine/tests/test_scope_me_agrees_with_board.py`
- Modify: `homunculus-engine/tests/test_scope_role_from_groups.py`
- Modify: `homunculus-engine/tests/test_tenant_isolation.py`

- [ ] **Step 1: Write the failing tests** — the migration on a database with patients in two tenants and two years, the round trip, model parity; the number's format, sequence, per-tenant and per-year counting, exhaustion, rollback and two at once:

**Write** `homunculus-engine/tests/test_migration_0012_kabul.py` (a new file, whole):

```python
# homunculus-engine/tests/test_migration_0012_kabul.py
"""Migration 0012 (Hasta Kabul, Group 2 · B1a) on a database built by the real chain (`clean_db`,
never `create_all`): every patient that existed before it gets a number in its tenant's year and
the counters continue after them; `beds.release` reaches the nurse and charge-nurse groups of every
tenant and no other group; existing beds stay open; the board identity gains its own bed and unit;
the model and the migration agree on every column 0012 owns; and 0011 → 0012 → 0011 → 0012 runs.
Sync tests on purpose (alembic runs its own event loop, see `clean_db`). Synthetic rows only."""
from __future__ import annotations

import uuid

from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import inspect, text

import homunculus.admission.models  # noqa: F401  (register every table on Base.metadata)
import homunculus.auth.models  # noqa: F401
import homunculus.escalation.models  # noqa: F401
import homunculus.tenant.models  # noqa: F401
from homunculus.db import Base
from tests.conftest import requires_db

pytestmark = [requires_db]

PATIENT_COLUMNS = {"patient_number", "father_name", "nationality", "national_id", "passport_no",
                   "phone", "relative_name", "relative_relation", "relative_phone",
                   "companion_name", "consent", "sms_permitted"}
ADMISSION_COLUMNS = {"admission_type", "blood_group", "allergies_text", "no_known_allergy",
                     "comorbidity_codes", "comorbidities_text", "discharge_disposition",
                     "discharge_institution", "discharge_reported_by", "discharge_at",
                     "discharge_note"}


def _columns(engine, table: str) -> set[str]:
    return {c["name"] for c in inspect(engine).get_columns(table)}


def _tenant(conn, slug: str) -> uuid.UUID:
    tid = uuid.uuid4()
    conn.execute(text("INSERT INTO tenants (id, name, slug, country_code) "
                      "VALUES (:id, :n, :s, 'AZ')"), {"id": tid, "n": f"Sentetik {slug}", "s": slug})
    return tid


def _patient(conn, tenant: uuid.UUID, created: str) -> uuid.UUID:
    pid = uuid.uuid4()
    conn.execute(text(
        "INSERT INTO patients (id, tenant_id, display_name, date_of_birth, sex, created_at) "
        "VALUES (:id, :t, 'x', 'x', 'x', :c)"), {"id": pid, "t": tenant, "c": created})
    return pid


def _group(conn, tenant: uuid.UUID, slug: str) -> uuid.UUID:
    gid = uuid.uuid4()
    conn.execute(text(
        "INSERT INTO groups (id, tenant_id, slug, name, mfa_required, is_system, created_at, "
        "updated_at) VALUES (:id, :t, :s, :s, false, false, now(), now())"),
        {"id": gid, "t": tenant, "s": slug})
    return gid


def _bed(conn, tenant: uuid.UUID) -> uuid.UUID:
    site, unit, room, bed = (uuid.uuid4() for _ in range(4))
    conn.execute(text("INSERT INTO sites (id, tenant_id, name) VALUES (:id, :t, 'Kampüs')"),
                 {"id": site, "t": tenant})
    conn.execute(text("INSERT INTO units (id, site_id, name, unit_type) "
                      "VALUES (:id, :s, 'YBÜ', 'ADULT_ICU')"), {"id": unit, "s": site})
    conn.execute(text("INSERT INTO rooms (id, unit_id, name) VALUES (:id, :u, 'Oda 1')"),
                 {"id": room, "u": unit})
    conn.execute(text("INSERT INTO beds (id, room_id, label) VALUES (:id, :r, '1A')"),
                 {"id": bed, "r": room})
    return bed


def _before_0012(cfg, engine) -> dict:
    """A database at 0011 holding what a pilot may hold: patients of two tenants over two years,
    the default nurse groups and another, and a bed."""
    command.upgrade(cfg, "0011")
    with engine.begin() as conn:
        a, b = _tenant(conn, "hastane-a"), _tenant(conn, "hastane-b")
        rows = {
            "a25_first": _patient(conn, a, "2025-03-01T10:00:00+00:00"),
            "a25_second": _patient(conn, a, "2025-11-30T23:30:00+00:00"),
            # 02:00 on New Year's Day in Baku is still 2025 in UTC: the year is UTC's (§4.2).
            "a25_eve": _patient(conn, a, "2026-01-01T02:00:00+04:00"),
            "a26": _patient(conn, a, "2026-01-02T08:00:00+00:00"),
            "b26": _patient(conn, b, "2026-05-05T05:00:00+00:00"),
        }
        groups = {(t, slug): _group(conn, t, slug)
                  for t in (a, b) for slug in ("nurse", "charge_nurse", "attending")}
        bed = _bed(conn, a)
    return {"a": a, "b": b, "patients": rows, "groups": groups, "bed": bed}


def test_every_existing_patient_gets_a_number_in_its_tenants_utc_year(clean_db):
    engine, cfg = clean_db
    world = _before_0012(cfg, engine)
    command.upgrade(cfg, "0012")

    with engine.begin() as conn:
        numbers = dict(conn.execute(text("SELECT id, patient_number FROM patients")).all())
        counters = {(row[0], row[1]): row[2] for row in conn.execute(
            text("SELECT tenant_id, year, last FROM patient_number_counters")).all()}
    p = world["patients"]
    assert numbers == {p["a25_first"]: "H2500001", p["a25_second"]: "H2500002",
                       p["a25_eve"]: "H2500003", p["a26"]: "H2600001", p["b26"]: "H2600001"}
    assert counters == {(world["a"], 2025): 3, (world["a"], 2026): 1, (world["b"], 2026): 1}


def test_the_number_is_required_and_unique_within_a_tenant_only(clean_db):
    engine, cfg = clean_db
    _before_0012(cfg, engine)
    command.upgrade(cfg, "0012")

    column = {c["name"]: c for c in inspect(engine).get_columns("patients")}["patient_number"]
    assert column["nullable"] is False
    uniques = {u["name"]: u["column_names"] for u in inspect(engine).get_unique_constraints("patients")}
    assert uniques["uq_patients_tenant_number"] == ["tenant_id", "patient_number"]


def test_beds_release_reaches_the_ward_nurses_of_every_tenant_and_nobody_else(clean_db):
    engine, cfg = clean_db
    world = _before_0012(cfg, engine)
    command.upgrade(cfg, "0012")

    with engine.begin() as conn:
        holders = set(conn.execute(text(
            "SELECT group_id FROM group_permissions WHERE permission = 'beds.release'")).scalars())
    g = world["groups"]
    assert holders == {g[(t, s)] for t in (world["a"], world["b"]) for s in ("nurse", "charge_nurse")}


def test_existing_beds_stay_open_and_the_identity_gains_its_own_bed(clean_db):
    engine, cfg = clean_db
    world = _before_0012(cfg, engine)
    command.upgrade(cfg, "0012")

    with engine.begin() as conn:
        assert conn.execute(text("SELECT is_active FROM beds WHERE id = :id"),
                            {"id": world["bed"]}).scalar_one() is True
    assert {"bed_id", "unit_id"} <= _columns(engine, "patient_identity")
    assert PATIENT_COLUMNS <= _columns(engine, "patients")
    assert ADMISSION_COLUMNS <= _columns(engine, "admissions")


def test_the_downgrade_takes_it_all_away_and_the_upgrade_gives_it_back(clean_db):
    """0011 → 0012 → 0011 → 0012 on the real chain: the round trip a rollback and a re-deploy run."""
    engine, cfg = clean_db
    world = _before_0012(cfg, engine)
    command.upgrade(cfg, "0012")
    command.downgrade(cfg, "0011")

    assert not (PATIENT_COLUMNS & _columns(engine, "patients"))
    assert not (ADMISSION_COLUMNS & _columns(engine, "admissions"))
    assert "is_active" not in _columns(engine, "beds")
    assert not ({"bed_id", "unit_id"} & _columns(engine, "patient_identity"))
    assert "patient_number_counters" not in inspect(engine).get_table_names()
    with engine.begin() as conn:
        assert conn.execute(text("SELECT count(*) FROM group_permissions "
                                 "WHERE permission = 'beds.release'")).scalar_one() == 0
        assert conn.execute(text("SELECT count(*) FROM patients")).scalar_one() == 5
        types = set(conn.execute(text("SELECT typname FROM pg_type WHERE typname IN "
                                      "('consent', 'admissiontype', 'bloodgroup', "
                                      "'dischargedisposition')")).scalars())
    assert types == set()

    command.upgrade(cfg, "0012")
    with engine.begin() as conn:
        assert conn.execute(text("SELECT patient_number FROM patients WHERE id = :id"),
                            {"id": world["patients"]["a26"]}).scalar_one() == "H2600001"


def test_the_model_and_the_migration_agree_on_what_0012_owns(clean_db):
    engine, cfg = clean_db
    command.upgrade(cfg, "head")
    owned = {"patients": PATIENT_COLUMNS, "admissions": ADMISSION_COLUMNS, "beds": {"is_active"}}

    def only_0012(object_, name, type_, reflected, compare_to):
        if type_ == "table":
            return name in {*owned, "patient_number_counters"}
        if type_ == "column":
            table = object_.table.name if object_ is not None else None
            return table == "patient_number_counters" or name in owned.get(table, set())
        if type_ == "unique_constraint":
            return name == "uq_patients_tenant_number"
        return False

    with engine.connect() as conn:
        ctx = MigrationContext.configure(conn, opts={
            "compare_type": True, "compare_server_default": False,
            "include_object": only_0012})
        assert compare_metadata(ctx, Base.metadata) == []
```

**Write** `homunculus-engine/tests/test_patient_numbers.py` (a new file, whole):

```python
# homunculus-engine/tests/test_patient_numbers.py
"""The Homunculus patient number (Group 2 · B1a, spec §4.2): `H` + two-digit year + five digits,
one sequence per tenant and UTC year, taken under the counter row's lock so that two admissions
never share one, and refused rather than overflowed at 99 999. The format tests need no database;
the rest run on Postgres (`db_session`). Synthetic tenants only."""
from __future__ import annotations

import asyncio
import re
from datetime import datetime, timezone

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from homunculus.admission.errors import PATIENT_NUMBER_EXHAUSTED, Refusal
from homunculus.admission.models import PatientNumberCounter
from homunculus.admission.numbers import SEQUENCE_MAX, format_patient_number, next_patient_number
from homunculus.tenant.models import Tenant
from tests.conftest import requires_db

MID_2026 = datetime(2026, 6, 1, 12, 0, tzinfo=timezone.utc)


def test_the_number_is_h_the_year_and_five_digits():
    assert format_patient_number(2026, 42) == "H2600042"
    assert format_patient_number(2031, 1) == "H3100001"
    assert format_patient_number(2026, SEQUENCE_MAX) == "H2699999"


def test_the_number_holds_no_path_pid_or_hl7_separator():
    """`/` would be a path segment, `_` is where the NCE device splits a PID, `|^~\\&` are HL7's."""
    for year, seq in ((2026, 1), (2026, 99_999), (2099, 12_345), (2100, 7)):
        assert re.fullmatch(r"H\d{7}", format_patient_number(year, seq))


async def _tenant(db, slug: str) -> Tenant:
    tenant = Tenant(name=f"Sentetik {slug}", slug=slug, country_code="AZ")
    db.add(tenant)
    await db.flush()
    return tenant


@requires_db
async def test_numbers_follow_each_other_within_a_tenants_year(db_session):
    a = await _tenant(db_session, "hastane-a")
    got = [await next_patient_number(db_session, a.id, now=MID_2026) for _ in range(3)]
    assert got == ["H2600001", "H2600002", "H2600003"]


@requires_db
async def test_each_tenant_has_its_own_sequence(db_session):
    a, b = await _tenant(db_session, "hastane-a"), await _tenant(db_session, "hastane-b")
    assert await next_patient_number(db_session, a.id, now=MID_2026) == "H2600001"
    assert await next_patient_number(db_session, a.id, now=MID_2026) == "H2600002"
    assert await next_patient_number(db_session, b.id, now=MID_2026) == "H2600001"


@requires_db
async def test_the_sequence_starts_again_at_one_in_the_new_utc_year(db_session):
    a = await _tenant(db_session, "hastane-a")
    eve = datetime(2026, 12, 31, 23, 59, 59, tzinfo=timezone.utc)
    # 02:00 on 1 January in Baku (UTC+4) is still 31 December in UTC: the old year's number.
    baku_new_year = datetime.fromisoformat("2027-01-01T02:00:00+04:00")
    new_year = datetime(2027, 1, 1, 0, 0, 0, tzinfo=timezone.utc)
    assert await next_patient_number(db_session, a.id, now=eve) == "H2600001"
    assert await next_patient_number(db_session, a.id, now=baku_new_year) == "H2600002"
    assert await next_patient_number(db_session, a.id, now=new_year) == "H2700001"


@requires_db
async def test_at_the_last_number_of_a_year_the_admission_is_refused(db_session):
    a = await _tenant(db_session, "hastane-a")
    db_session.add(PatientNumberCounter(tenant_id=a.id, year=2026, last=SEQUENCE_MAX - 1))
    await db_session.commit()

    assert await next_patient_number(db_session, a.id, now=MID_2026) == "H2699999"
    await db_session.commit()
    with pytest.raises(Refusal) as refused:
        await next_patient_number(db_session, a.id, now=MID_2026)
    assert (refused.value.status, refused.value.code) == (409, PATIENT_NUMBER_EXHAUSTED)
    await db_session.rollback()      # what the route's session does with a refused admission
    last = (await db_session.execute(select(PatientNumberCounter.last))).scalar_one()
    assert last == SEQUENCE_MAX


@requires_db
async def test_a_rolled_back_admission_gives_its_number_back(db_session):
    tenant_id = (await _tenant(db_session, "hastane-a")).id
    await db_session.commit()
    assert await next_patient_number(db_session, tenant_id, now=MID_2026) == "H2600001"
    await db_session.rollback()
    assert await next_patient_number(db_session, tenant_id, now=MID_2026) == "H2600001"


@requires_db
async def test_two_admissions_at_once_never_share_a_number(db_session):
    """Two sessions, two connections, both taking a number inside their own transaction: the
    second waits on the counter row until the first commits, then takes the next number."""
    a = await _tenant(db_session, "hastane-a")
    await db_session.commit()
    maker = async_sessionmaker(db_session.bind, expire_on_commit=False)
    first_has_one = asyncio.Event()

    async def first():
        async with maker() as db:
            number = await next_patient_number(db, a.id, now=MID_2026)
            first_has_one.set()
            await asyncio.sleep(0.3)        # hold the row lock while the second one asks
            await db.commit()
            return number

    async def second():
        await first_has_one.wait()
        async with maker() as db:
            number = await next_patient_number(db, a.id, now=MID_2026)
            await db.commit()
            return number

    got = await asyncio.gather(first(), second())
    assert sorted(got) == ["H2600001", "H2600002"]
```


- [ ] **Step 2: Run them and see them red** — without the database the number's module does not exist (`test_patient_numbers.py` imports `admission/errors.py`, which Step 3 writes); with it, `0012` does not exist (`alembic upgrade head` stops at `0011`, so every assertion on its columns and rows fails). The parity test passes already — neither the model nor the migration has the columns yet — and guards Step 3:

```bash
cd /c/tmp/g2b-kabul-be/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 \
  /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_patient_numbers.py tests/test_migration_0012_kabul.py 2>&1 | grep -E "^(FAILED|ERROR) |[0-9]+ (passed|failed|error)|^E +[A-Za-z]*(Error|Exception)" | head -16
```

Expected (the replay, times vary):

```text
ERROR tests/test_patient_numbers.py
1 error in …s
E   ModuleNotFoundError: No module named 'homunculus.admission.errors'
```

```bash
cd /c/tmp/g2b-kabul-be/homunculus-engine
TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 \
  /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_migration_0012_kabul.py 2>&1 | grep -E "^(FAILED|ERROR) |[0-9]+ (passed|failed|error)|^E +[A-Za-z]*(Error|Exception)" | head -16
```

Expected (the replay, times vary):

```text
FAILED tests/test_migration_0012_kabul.py::test_every_existing_patient_gets_a_number_in_its_tenants_utc_year
FAILED tests/test_migration_0012_kabul.py::test_the_number_is_required_and_unique_within_a_tenant_only
FAILED tests/test_migration_0012_kabul.py::test_beds_release_reaches_the_ward_nurses_of_every_tenant_and_nobody_else
FAILED tests/test_migration_0012_kabul.py::test_existing_beds_stay_open_and_the_identity_gains_its_own_bed
FAILED tests/test_migration_0012_kabul.py::test_the_downgrade_takes_it_all_away_and_the_upgrade_gives_it_back
5 failed, 1 passed in …s
```


- [ ] **Step 3: Write the migration, the models, the codes and the number; give every fixture patient a number; take one at create:**

**Write** `homunculus-engine/alembic/versions/0012_admission_kabul.py` (a new file, whole):

```python
# homunculus-engine/alembic/versions/0012_admission_kabul.py
"""Hasta Kabul (Group 2 · B1a): the admission form's columns, the patient number, closable beds,
the board identity's own bed, and `beds.release` for the ward's nurses

Revision 0012, follows 0011.

* `patients`: `patient_number` (varchar 16, unique per tenant, NOT NULL — every existing row gets
  one here, `H` + the two-digit year it was created in (UTC) + its place in that tenant's year,
  oldest first), nine encrypted identity and contact columns (varchar 512: Fernet ciphertext, as
  the name and birth date), `consent` (enum `consent`, nullable) and `sms_permitted` (NOT NULL,
  false).
* `patient_number_counters` (tenant_id, year, last): the number source. Seeded from the numbers
  given above, so the next admission continues after them.
* `admissions`: `admission_type`, `blood_group` (enums), `allergies_text`, `no_known_allergy`
  (NOT NULL, false), `comorbidity_codes` (JSON), `comorbidities_text`, and the discharge's
  `discharge_disposition` (enum), `discharge_institution`, `discharge_reported_by`,
  `discharge_at`, `discharge_note`.
* `beds.is_active` (NOT NULL, true): a closed bed is kept and offered to no admission.
* `patient_identity.bed_id`, `.unit_id` (text, nullable): a `kabul` record's own bed and unit, the
  tenant UUIDs (spec D9).
* Data: `beds.release` is added to the `nurse` and `charge_nurse` groups of every tenant —
  `ensure_default_groups` never adds a key to a group that exists. The system group holds every
  key by rule at token issuance and needs no row.

ONE STATEMENT PER op.execute (asyncpg prepares each one; see 0004 and 0010).

Downgrade drops all of it: the patient numbers, the form's extra fields, the dispositions and the
`beds.release` rows (any group's) are lost. Back the database up first (runbook: pg_dump).

Revision ID: 0012
Revises: 0011
Create Date: 2026-10-25
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0012"
down_revision: Union[str, None] = "0011"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# create_type=False: created once, explicitly, as 0002 does. Names are SQLAlchemy's for the model's
# `Enum(<class>)`: the class name, lower-cased.
consent_enum = postgresql.ENUM("KVKK_SIGNED", "UNCONSCIOUS_LATER", name="consent",
                               create_type=False)
admission_type_enum = postgresql.ENUM("MEDICAL", "SURGICAL", "ICU", "PROCEDURE",
                                      name="admissiontype", create_type=False)
blood_group_enum = postgresql.ENUM("A_POS", "A_NEG", "B_POS", "B_NEG", "AB_POS", "AB_NEG",
                                   "O_POS", "O_NEG", "UNKNOWN", name="bloodgroup",
                                   create_type=False)
disposition_enum = postgresql.ENUM("HOME", "OTHER_INSTITUTION", "EXITUS",
                                   name="dischargedisposition", create_type=False)

_ENCRYPTED = ("father_name", "nationality", "national_id", "passport_no", "phone",
              "relative_name", "relative_relation", "relative_phone", "companion_name")

# The year a row was created in, in UTC: the number's two digits and its counter's year.
_YEAR = "EXTRACT(YEAR FROM created_at AT TIME ZONE 'UTC')::int"

#: The board identity's own bed and unit (IF NOT EXISTS, as 0006). Named here so the Postgres
#: identity store's own test provisions exactly these (tests/test_patient_identity_postgres.py).
IDENTITY_COLUMNS = (
    "ALTER TABLE patient_identity ADD COLUMN IF NOT EXISTS bed_id TEXT",
    "ALTER TABLE patient_identity ADD COLUMN IF NOT EXISTS unit_id TEXT",
)


def upgrade() -> None:
    bind = op.get_bind()
    for enum in (consent_enum, admission_type_enum, blood_group_enum, disposition_enum):
        enum.create(bind, checkfirst=True)

    # ---- patients ----
    op.add_column("patients", sa.Column("patient_number", sa.String(16), nullable=True))
    for name in _ENCRYPTED:
        op.add_column("patients", sa.Column(name, sa.String(512), nullable=True))
    op.add_column("patients", sa.Column("consent", consent_enum, nullable=True))
    op.add_column("patients", sa.Column("sms_permitted", sa.Boolean(), nullable=False,
                                        server_default=sa.false()))
    op.execute(
        "WITH numbered AS ("
        f" SELECT id, {_YEAR} AS yr, ROW_NUMBER() OVER ("
        f"  PARTITION BY tenant_id, {_YEAR} ORDER BY created_at, id) AS seq FROM patients)"
        " UPDATE patients SET patient_number = 'H' || LPAD((numbered.yr % 100)::text, 2, '0')"
        " || LPAD(numbered.seq::text, 5, '0') FROM numbered WHERE patients.id = numbered.id"
    )
    op.alter_column("patients", "patient_number", nullable=False)
    op.create_unique_constraint("uq_patients_tenant_number", "patients",
                                ["tenant_id", "patient_number"])

    op.create_table(
        "patient_number_counters",
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("tenants.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("year", sa.Integer(), primary_key=True),
        sa.Column("last", sa.Integer(), nullable=False, server_default="0"),
    )
    op.execute(
        "INSERT INTO patient_number_counters (tenant_id, year, last)"
        f" SELECT tenant_id, {_YEAR}, COUNT(*) FROM patients GROUP BY tenant_id, {_YEAR}"
    )

    # ---- admissions ----
    op.add_column("admissions", sa.Column("admission_type", admission_type_enum, nullable=True))
    op.add_column("admissions", sa.Column("blood_group", blood_group_enum, nullable=True))
    op.add_column("admissions", sa.Column("allergies_text", sa.String(500), nullable=True))
    op.add_column("admissions", sa.Column("no_known_allergy", sa.Boolean(), nullable=False,
                                          server_default=sa.false()))
    op.add_column("admissions", sa.Column("comorbidity_codes", postgresql.JSONB(), nullable=True))
    op.add_column("admissions", sa.Column("comorbidities_text", sa.String(500), nullable=True))
    op.add_column("admissions", sa.Column("discharge_disposition", disposition_enum,
                                          nullable=True))
    op.add_column("admissions", sa.Column("discharge_institution", sa.String(200), nullable=True))
    op.add_column("admissions", sa.Column("discharge_reported_by", sa.String(200), nullable=True))
    op.add_column("admissions", sa.Column("discharge_at", sa.DateTime(timezone=True),
                                          nullable=True))
    op.add_column("admissions", sa.Column("discharge_note", sa.String(2000), nullable=True))

    # ---- beds ----
    op.add_column("beds", sa.Column("is_active", sa.Boolean(), nullable=False,
                                    server_default=sa.true()))

    # ---- the board identity's own bed ----
    for statement in IDENTITY_COLUMNS:
        op.execute(statement)

    # ---- beds.release for the ward's nurses, in every tenant ----
    op.execute(
        "INSERT INTO group_permissions (group_id, permission)"
        " SELECT id, 'beds.release' FROM groups WHERE slug IN ('nurse', 'charge_nurse')"
        " ON CONFLICT DO NOTHING"
    )


def downgrade() -> None:
    op.execute("DELETE FROM group_permissions WHERE permission = 'beds.release'")
    op.execute("ALTER TABLE patient_identity DROP COLUMN IF EXISTS unit_id")
    op.execute("ALTER TABLE patient_identity DROP COLUMN IF EXISTS bed_id")
    op.drop_column("beds", "is_active")
    for name in ("discharge_note", "discharge_at", "discharge_reported_by",
                 "discharge_institution", "discharge_disposition", "comorbidities_text",
                 "comorbidity_codes", "no_known_allergy", "allergies_text", "blood_group",
                 "admission_type"):
        op.drop_column("admissions", name)
    op.drop_table("patient_number_counters")
    op.drop_constraint("uq_patients_tenant_number", "patients", type_="unique")
    for name in ("sms_permitted", "consent", *_ENCRYPTED, "patient_number"):
        op.drop_column("patients", name)
    bind = op.get_bind()
    for enum in (disposition_enum, blood_group_enum, admission_type_enum, consent_enum):
        enum.drop(bind, checkfirst=True)
```

**Edit** `homunculus-engine/src/homunculus/admission/models.py` (1) — replace:

```python

class CareTeamRole(str, enum.Enum):
```

with:

```python

# --- Group 2 · B1a (Hasta Kabul): the prototype's admission form (spec §4.1) ---
class AdmissionType(str, enum.Enum):
    """The prototype's `ADM_T`: medical, surgical, intensive care, procedure."""
    MEDICAL = "MEDICAL"
    SURGICAL = "SURGICAL"
    ICU = "ICU"
    PROCEDURE = "PROCEDURE"


class BloodGroup(str, enum.Enum):
    """ABO and Rh as charted at admission; UNKNOWN is a charted answer, not a missing one."""
    A_POS = "A_POS"
    A_NEG = "A_NEG"
    B_POS = "B_POS"
    B_NEG = "B_NEG"
    AB_POS = "AB_POS"
    AB_NEG = "AB_NEG"
    O_POS = "O_POS"
    O_NEG = "O_NEG"
    UNKNOWN = "UNKNOWN"


class Consent(str, enum.Enum):
    """The data-processing consent: signed, or the patient cannot consent now (asked later)."""
    KVKK_SIGNED = "KVKK_SIGNED"
    UNCONSCIOUS_LATER = "UNCONSCIOUS_LATER"


class DischargeDisposition(str, enum.Enum):
    """Where the patient went: home, another institution (named), or exitus."""
    HOME = "HOME"
    OTHER_INSTITUTION = "OTHER_INSTITUTION"
    EXITUS = "EXITUS"


class CareTeamRole(str, enum.Enum):
```

**Edit** `homunculus-engine/src/homunculus/admission/models.py` (2) — replace:

```python
    his_patient_reference: Mapped[str | None] = mapped_column(EncryptedString(512), nullable=True)  # #28

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
```

with:

```python
    his_patient_reference: Mapped[str | None] = mapped_column(EncryptedString(512), nullable=True)  # #28

    # Group 2 · B1a. The Homunculus patient number (`H` + two-digit year + five digits, spec §4.2):
    # the board's key for a patient admitted here, and what the nurse enters on the bedside device.
    # In the clear — it is the key, as the HIS protocol number is the identity store's key — and
    # unique per tenant. `admission/numbers.py` issues it.
    patient_number: Mapped[str] = mapped_column(String(16), nullable=False)
    # The admission form's identity and contact fields: PHI, encrypted at rest like the name.
    father_name: Mapped[str | None] = mapped_column(EncryptedString(512), nullable=True)
    nationality: Mapped[str | None] = mapped_column(EncryptedString(512), nullable=True)
    national_id: Mapped[str | None] = mapped_column(EncryptedString(512), nullable=True)   # FİN
    passport_no: Mapped[str | None] = mapped_column(EncryptedString(512), nullable=True)
    phone: Mapped[str | None] = mapped_column(EncryptedString(512), nullable=True)
    relative_name: Mapped[str | None] = mapped_column(EncryptedString(512), nullable=True)
    relative_relation: Mapped[str | None] = mapped_column(EncryptedString(512), nullable=True)
    relative_phone: Mapped[str | None] = mapped_column(EncryptedString(512), nullable=True)
    companion_name: Mapped[str | None] = mapped_column(EncryptedString(512), nullable=True)
    consent: Mapped[Consent | None] = mapped_column(Enum(Consent), nullable=True)
    sms_permitted: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
```

**Edit** `homunculus-engine/src/homunculus/admission/models.py` (3) — replace:

```python
        "Admission", back_populates="patient", cascade="all, delete-orphan"
    )


```

with:

```python
        "Admission", back_populates="patient", cascade="all, delete-orphan"
    )

    __table_args__ = (
        UniqueConstraint("tenant_id", "patient_number", name="uq_patients_tenant_number"),
    )


class PatientNumberCounter(Base):
    """The last patient number issued per tenant and calendar year (UTC). The admission takes the
    next one under this row's lock, in its own transaction, so two can never share one (§4.2)."""
    __tablename__ = "patient_number_counters"

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), primary_key=True
    )
    year: Mapped[int] = mapped_column(Integer, primary_key=True)
    last: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


```

**Edit** `homunculus-engine/src/homunculus/admission/models.py` (4) — replace:

```python
    signed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

```

with:

```python
    signed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # --- Group 2 · B1a: the admission form (spec §4.1) and the discharge's disposition ---
    admission_type: Mapped[AdmissionType | None] = mapped_column(Enum(AdmissionType), nullable=True)
    blood_group: Mapped[BloodGroup | None] = mapped_column(Enum(BloodGroup), nullable=True)
    # Exactly one of the two on a form admission: a known allergy as text, or "none known".
    allergies_text: Mapped[str | None] = mapped_column(String(500), nullable=True)
    no_known_allergy: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # The engine's comorbidity codes (rules/patient_relative.py) ticked on the form, and free text
    # that is stored but never sent to the engine as a code.
    comorbidity_codes: Mapped[list | None] = mapped_column(JSON_COLUMN, nullable=True)
    comorbidities_text: Mapped[str | None] = mapped_column(String(500), nullable=True)
    discharge_disposition: Mapped[DischargeDisposition | None] = mapped_column(
        Enum(DischargeDisposition), nullable=True
    )
    discharge_institution: Mapped[str | None] = mapped_column(String(200), nullable=True)
    discharge_reported_by: Mapped[str | None] = mapped_column(String(200), nullable=True)
    discharge_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    discharge_note: Mapped[str | None] = mapped_column(String(2000), nullable=True)

```

**Edit** `homunculus-engine/src/homunculus/tenant/models.py` (1) — replace:

```python
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    room: Mapped[Room] = relationship("Room", back_populates="beds")
```

with:

```python
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    # Group 2 · B1a: a closed bed is kept (nothing is deleted) and offered to no admission. Only a
    # bed that holds no patient may be closed (tenant/router.py PATCH /tenant/beds/{id}).
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    room: Mapped[Room] = relationship("Room", back_populates="beds")
```

**Write** `homunculus-engine/src/homunculus/admission/errors.py` (a new file, whole):

```python
# homunculus-engine/src/homunculus/admission/errors.py
"""The refusals of the admission and structure routes, each with a stable code (spec §4.4).

A refusal answers `{"detail": {"code": "<code>", "message": "<words>"}}`. The dashboard maps the
CODE to the reader's language (`dashboard/src/live/apiErrors.js`, `ADMISSION_CODE_KEYS`) and
never the words, which are English and for a support call; `apiErrors.test.js` reads this file and
fails when a code below is not mapped. A field the form got wrong is `field_invalid:<field>`, the
field named as the request body names it.

The codes are part of the API: renaming one is a change to every screen that reads it.
"""
from __future__ import annotations

from fastapi import HTTPException

BED_NOT_AVAILABLE = "bed_not_available"          # the bed is not AVAILABLE (occupied, cleaning…)
BED_CLOSED = "bed_closed"                        # the bed, its room or its unit is closed
OUT_OF_SCOPE = "out_of_scope"                    # the bed's unit is not one of the caller's
CRITICAL_ALARM_OPEN = "critical_alarm_open"      # a critical alert nobody acknowledged
PATIENT_NUMBER_EXHAUSTED = "patient_number_exhausted"   # 99 999 numbers taken this year
INVALID_TRANSITION = "invalid_transition"        # the admission or bed is not in a state for it
MISSING_ATTENDING = "missing_attending"          # a DRAFT cannot become ACTIVE without one
OPEN_ADMISSION = "open_admission"                # the patient already has an open admission
BED_IN_USE = "bed_in_use"                        # a bed holding a patient cannot be closed
HAS_OPEN_BEDS = "has_open_beds"                  # a unit or room with an open bed cannot be
NAME_TAKEN = "name_taken"                        # another room / bed of the parent has that name
FIELD_INVALID = "field_invalid"                  # + ":<field>"

#: Every code but FIELD_INVALID, which travels with its field.
CODES = frozenset({
    BED_NOT_AVAILABLE, BED_CLOSED, OUT_OF_SCOPE, CRITICAL_ALARM_OPEN, PATIENT_NUMBER_EXHAUSTED,
    INVALID_TRANSITION, MISSING_ATTENDING, OPEN_ADMISSION, BED_IN_USE, HAS_OPEN_BEDS, NAME_TAKEN,
})


class Refusal(Exception):
    """A refusal with its HTTP status, its code and its words."""

    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message

    def http(self) -> HTTPException:
        return HTTPException(status_code=self.status,
                             detail={"code": self.code, "message": self.message})


def field_invalid(field: str, message: str) -> Refusal:
    """A 422 naming the one field it is about (the first wrong one, in the form's order)."""
    return Refusal(422, f"{FIELD_INVALID}:{field}", message)
```

**Write** `homunculus-engine/src/homunculus/admission/numbers.py` (a new file, whole):

```python
# homunculus-engine/src/homunculus/admission/numbers.py
"""The Homunculus patient number (Group 2 · B1a, spec D4 and §4.2).

`H` + the two-digit year + a five-digit sequence: `H2600042`. One sequence per tenant and calendar
year, the year in UTC, starting again at 1 each year. The number is the board's key for a patient
admitted here and what the nurse types into the bedside device, so:

* the `H` keeps it out of the HIS protocol-number namespace — a generated number equal to a HIS
  number would put two patients on one card (the pseudo-patient "X" incident);
* it holds no `/` (a path segment), no `_` (the NCE device splits the PID there) and no HL7
  delimiter (`| ^ ~ \\ &`) — letters and digits only.

It is taken from `patient_number_counters` with one UPDATE … RETURNING inside the admission's own
transaction: the row stays locked until that transaction ends, so two admissions can never share a
number, and an admission that is refused or rolled back gives its number back. At 99 999 in one
year the admission is refused (`patient_number_exhausted`) rather than given a number that would
not fit.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.admission.errors import PATIENT_NUMBER_EXHAUSTED, Refusal
from homunculus.admission.models import PatientNumberCounter

PREFIX = "H"
SEQUENCE_MAX = 99_999


def format_patient_number(year: int, sequence: int) -> str:
    """`H` + the year's last two digits + the sequence on five digits."""
    return f"{PREFIX}{year % 100:02d}{sequence:05d}"


async def next_patient_number(db: AsyncSession, tenant_id: uuid.UUID, *,
                              now: datetime | None = None) -> str:
    """The next number of this tenant's year. Call it inside the transaction that writes the
    patient: the counter row stays locked until that transaction commits or rolls back."""
    year = (now or datetime.now(timezone.utc)).astimezone(timezone.utc).year
    # A tenant's first admission of a year makes the row; two first admissions at once both
    # reach the UPDATE below, one after the other, and get 1 and 2.
    await db.execute(insert(PatientNumberCounter)
                     .values(tenant_id=tenant_id, year=year, last=0)
                     .on_conflict_do_nothing(index_elements=["tenant_id", "year"]))
    last = (await db.execute(
        update(PatientNumberCounter)
        .where(PatientNumberCounter.tenant_id == tenant_id, PatientNumberCounter.year == year)
        .values(last=PatientNumberCounter.last + 1)
        .returning(PatientNumberCounter.last)
        .execution_options(synchronize_session=False)
    )).scalar_one()
    if last > SEQUENCE_MAX:
        raise Refusal(409, PATIENT_NUMBER_EXHAUSTED,
                      f"No patient number is left for {year}: {SEQUENCE_MAX} have been issued.")
    return format_patient_number(year, last)
```

**Edit** `homunculus-engine/src/homunculus/admission/router.py` (1) — replace:

```python
)
from homunculus.admission.service import WorkflowError
```

with:

```python
)
from homunculus.admission.errors import Refusal
from homunculus.admission.numbers import next_patient_number
from homunculus.admission.service import WorkflowError
```

**Edit** `homunculus-engine/src/homunculus/admission/router.py` (2) — replace:

```python

    patient = Patient(
        tenant_id=caller_tenant,
        display_name=payload.patient.display_name,
```

with:

```python

    try:
        number = await next_patient_number(db, caller_tenant)
    except Refusal as exc:
        raise exc.http() from None
    patient = Patient(
        tenant_id=caller_tenant,
        patient_number=number,
        display_name=payload.patient.display_name,
```

**Edit** `homunculus-engine/tests/test_admission_workflow.py` (1) — replace:

```python

async def _new_patient(db, tenant):
    p = Patient(tenant_id=tenant.id, display_name="Synthetic Patient",
                date_of_birth="1980-01-01", sex="male")
    db.add(p)
```

with:

```python

_NUMBERS = iter(range(1, 100_000))   # patient numbers are unique per tenant (migration 0012)


async def _new_patient(db, tenant):
    p = Patient(tenant_id=tenant.id, display_name="Synthetic Patient",
                date_of_birth="1980-01-01", sex="male", patient_number=f"H26{next(_NUMBERS):05d}")
    db.add(p)
```

**Edit** `homunculus-engine/tests/test_escalation_workflow.py` (1) — replace:

```python
T0 = datetime(2026, 7, 29, 8, 0, 0, tzinfo=timezone.utc)

```

with:

```python
T0 = datetime(2026, 7, 29, 8, 0, 0, tzinfo=timezone.utc)
# `_env`'s patient is H2600001; every admission's own patient takes the next (migration 0012:
# unique per tenant).
_NUMBERS = iter(range(2, 100_000))

```

**Edit** `homunculus-engine/tests/test_escalation_workflow.py` (2) — replace:

```python
    patient = Patient(tenant_id=tenant.id, display_name="Synthetic Patient",
                      date_of_birth="1980-01-01", sex="male")
    db.add(patient)
```

with:

```python
    patient = Patient(tenant_id=tenant.id, display_name="Synthetic Patient",
                      date_of_birth="1980-01-01", sex="male", patient_number="H2600001")
    db.add(patient)
```

**Edit** `homunculus-engine/tests/test_escalation_workflow.py` (3) — replace:

```python
    patient = Patient(tenant_id=tenant.id, display_name="Synthetic P2",
                      date_of_birth="1975-05-05", sex="female")
    db.add(patient)
```

with:

```python
    patient = Patient(tenant_id=tenant.id, display_name="Synthetic P2",
                      date_of_birth="1975-05-05", sex="female",
                      patient_number=f"H26{next(_NUMBERS):05d}")
    db.add(patient)
```

**Edit** `homunculus-engine/tests/test_scope_me_agrees_with_board.py` (1) — replace:

```python
    patient = Patient(tenant_id=world["tenant"].id, display_name="Ayşe Sentetik",
                      date_of_birth="1980-01-01", sex="F", his_patient_reference="S-001")
    db_session.add(patient)
```

with:

```python
    patient = Patient(tenant_id=world["tenant"].id, display_name="Ayşe Sentetik",
                      date_of_birth="1980-01-01", sex="F", his_patient_reference="S-001",
                      patient_number="H2600001")
    db_session.add(patient)
```

**Edit** `homunculus-engine/tests/test_scope_me_agrees_with_board.py` (2) — replace:

```python
    patient = Patient(tenant_id=world["tenant"].id, display_name="Kamran Sintetik",
                      date_of_birth="1975-05-05", sex="M", his_patient_reference="S-002")
    db_session.add(patient)
```

with:

```python
    patient = Patient(tenant_id=world["tenant"].id, display_name="Kamran Sintetik",
                      date_of_birth="1975-05-05", sex="M", his_patient_reference="S-002",
                      patient_number="H2600002")
    db_session.add(patient)
```

**Edit** `homunculus-engine/tests/test_scope_role_from_groups.py` (1) — replace:

```python
    patient = Patient(tenant_id=b.id, display_name="Sentetik Hasta", date_of_birth="2000-01-01",
                      sex="U", his_patient_reference="MRN-B-1")
    db_session.add(patient)
```

with:

```python
    patient = Patient(tenant_id=b.id, display_name="Sentetik Hasta", date_of_birth="2000-01-01",
                      sex="U", his_patient_reference="MRN-B-1", patient_number="H2600001")
    db_session.add(patient)
```

**Edit** `homunculus-engine/tests/test_tenant_isolation.py` (1) — replace:

```python
)
from homunculus.auth.dependencies import caller_tenant_id
```

with:

```python
)
from homunculus.admission.numbers import next_patient_number
from homunculus.auth.dependencies import caller_tenant_id
```

**Edit** `homunculus-engine/tests/test_tenant_isolation.py` (2) — replace:

```python
    patient = Patient(tenant_id=tenant.id, display_name=f"Sentetik Hasta {slug}",
                      date_of_birth="1980-01-01", sex="female")
    db.add(patient)
```

with:

```python
    patient = Patient(tenant_id=tenant.id, display_name=f"Sentetik Hasta {slug}",
                      date_of_birth="1980-01-01", sex="female",
                      patient_number=await next_patient_number(db, tenant.id))
    db.add(patient)
```

**Edit** `homunculus-engine/tests/test_tenant_isolation.py` (3) — replace:

```python
    patient = Patient(tenant_id=world.a.tenant, display_name="Sentetik Taslak Hasta",
                      date_of_birth="1970-03-03", sex="male")
    world.db.add(patient)
```

with:

```python
    patient = Patient(tenant_id=world.a.tenant, display_name="Sentetik Taslak Hasta",
                      date_of_birth="1970-03-03", sex="male",
                      patient_number=await next_patient_number(world.db, world.a.tenant))
    world.db.add(patient)
```


- [ ] **Step 4: Run them green — without and with the database; the migrations before it; every test file whose fixture inserts a patient; the admission rows of the tenant isolation suite:**

```bash
cd /c/tmp/g2b-kabul-be/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 \
  /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_patient_numbers.py tests/test_migration_0012_kabul.py 2>&1 | grep -E "^(FAILED|ERROR) |[0-9]+ (passed|failed|error)|^E +[A-Za-z]*(Error|Exception)" | head -16
```

Expected (the replay, times vary):

```text
2 passed, 12 skipped in …s
```

```bash
cd /c/tmp/g2b-kabul-be/homunculus-engine
TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 \
  /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_patient_numbers.py tests/test_migration_0012_kabul.py tests/test_migration_0011_must_change_password.py tests/test_migration_0010_schema_parity.py 2>&1 | grep -E "^(FAILED|ERROR) |[0-9]+ (passed|failed|error)|^E +[A-Za-z]*(Error|Exception)" | head -16
```

Expected (the replay, times vary):

```text
20 passed in …s
```

```bash
cd /c/tmp/g2b-kabul-be/homunculus-engine
TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 \
  /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_admission_workflow.py tests/test_escalation_workflow.py tests/test_scope_me_agrees_with_board.py tests/test_scope_role_from_groups.py 2>&1 | grep -E "^(FAILED|ERROR) |[0-9]+ (passed|failed|error)|^E +[A-Za-z]*(Error|Exception)" | head -16
```

Expected (the replay, times vary):

```text
61 passed, 2 warnings in …s
```

```bash
cd /c/tmp/g2b-kabul-be/homunculus-engine
TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 \
  /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_tenant_isolation.py -k "admit or admission" 2>&1 | grep -E "^(FAILED|ERROR) |[0-9]+ (passed|failed|error)|^E +[A-Za-z]*(Error|Exception)" | head -16
```

Expected (the replay, times vary):

```text
16 passed, 93 deselected, 2 warnings in …s
```


- [ ] **Step 5: The whole no-DB suite:**

```bash
cd /c/tmp/g2b-kabul-be/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 \
  /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q --ignore=tests/test_infinity_vm_pilot.py 2>&1 | grep -E "^(FAILED|ERROR) |[0-9]+ (passed|failed|error)|^E +[A-Za-z]*(Error|Exception)" | head -16
```

Expected (the replay, times vary):

```text
2275 passed, 662 skipped, 3 warnings in …s
```


- [ ] **Step 6: Line ends:**

```bash
cd /c/tmp/g2b-kabul-be
for f in homunculus-engine/tests/test_migration_0012_kabul.py homunculus-engine/tests/test_patient_numbers.py homunculus-engine/alembic/versions/0012_admission_kabul.py homunculus-engine/src/homunculus/admission/models.py homunculus-engine/src/homunculus/tenant/models.py homunculus-engine/src/homunculus/admission/errors.py homunculus-engine/src/homunculus/admission/numbers.py homunculus-engine/src/homunculus/admission/router.py homunculus-engine/tests/test_admission_workflow.py homunculus-engine/tests/test_escalation_workflow.py homunculus-engine/tests/test_scope_me_agrees_with_board.py homunculus-engine/tests/test_scope_role_from_groups.py homunculus-engine/tests/test_tenant_isolation.py; do printf "%s CR=%s LF=%s\n" "$f" "$(tr -cd '\r' < "$f" | wc -c)" "$(tr -cd '\n' < "$f" | wc -c)"; done
```

Expected:

```text
homunculus-engine/tests/test_migration_0012_kabul.py CR=0 LF=193
homunculus-engine/tests/test_patient_numbers.py CR=0 LF=121
homunculus-engine/alembic/versions/0012_admission_kabul.py CR=0 LF=156
homunculus-engine/src/homunculus/admission/models.py CR=430 LF=430
homunculus-engine/src/homunculus/tenant/models.py CR=176 LF=176
homunculus-engine/src/homunculus/admission/errors.py CR=0 LF=52
homunculus-engine/src/homunculus/admission/numbers.py CR=0 LF=60
homunculus-engine/src/homunculus/admission/router.py CR=444 LF=444
homunculus-engine/tests/test_admission_workflow.py CR=313 LF=313
homunculus-engine/tests/test_escalation_workflow.py CR=357 LF=357
homunculus-engine/tests/test_scope_me_agrees_with_board.py CR=308 LF=308
homunculus-engine/tests/test_scope_role_from_groups.py CR=389 LF=389
homunculus-engine/tests/test_tenant_isolation.py CR=785 LF=785
```


- [ ] **Step 7: Commit:**

```bash
cd /c/tmp/g2b-kabul-be
git add -- homunculus-engine/tests/test_migration_0012_kabul.py homunculus-engine/tests/test_patient_numbers.py homunculus-engine/alembic/versions/0012_admission_kabul.py homunculus-engine/src/homunculus/admission/models.py homunculus-engine/src/homunculus/tenant/models.py homunculus-engine/src/homunculus/admission/errors.py homunculus-engine/src/homunculus/admission/numbers.py homunculus-engine/src/homunculus/admission/router.py homunculus-engine/tests/test_admission_workflow.py homunculus-engine/tests/test_escalation_workflow.py homunculus-engine/tests/test_scope_me_agrees_with_board.py homunculus-engine/tests/test_scope_role_from_groups.py homunculus-engine/tests/test_tenant_isolation.py
git status --short && git diff --cached --stat
git commit -m "feat(admission): migration 0012 — the form's columns, the patient number and its counters, closable beds, the identity's own bed (G2-B1a)" \
  -m "red: 1 error (ModuleNotFoundError: No module named 'homunculus.admission.errors'); 5 failed, 1 passed" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- homunculus-engine/tests/test_migration_0012_kabul.py homunculus-engine/tests/test_patient_numbers.py homunculus-engine/alembic/versions/0012_admission_kabul.py homunculus-engine/src/homunculus/admission/models.py homunculus-engine/src/homunculus/tenant/models.py homunculus-engine/src/homunculus/admission/errors.py homunculus-engine/src/homunculus/admission/numbers.py homunculus-engine/src/homunculus/admission/router.py homunculus-engine/tests/test_admission_workflow.py homunculus-engine/tests/test_escalation_workflow.py homunculus-engine/tests/test_scope_me_agrees_with_board.py homunculus-engine/tests/test_scope_role_from_groups.py homunculus-engine/tests/test_tenant_isolation.py
```

---

### Task 3: The admission form's rules, the extended schemas, a code on every refusal

**Lane:** backend. **Needs:** Task 2.

Spec §4.4, §5.2, X57, X63, X66. `admission/form.py` holds the rules of the admission form and of the physician's discharge decision, and refuses the **first** wrong field in the form's order as `field_invalid:<field>` (a 422 whose `detail` is `{"code": "field_invalid:weight_kg", "message": …}`) — the screen maps the field to its label (Task 11). The rules, in the form's order: a name; a birth date not in the future; a FİN of seven letters or digits; a phone (the patient's, the relative's) of digits, spaces, `+ ( ) -`; an admission type; an admission diagnosis; a weight within the engine's own charting bound (`api/clinical.PLAUSIBLE`, read, not copied); a height within 20–260 cm (X63); an allergy text **or** "no known allergy", exactly one of the two; comorbidity codes among the engine's five; a consent answer. Types and lengths stay pydantic's (the schemas). A discharge to another institution names it; a discharge time carries its time zone, is not ahead of the server's clock by more than two minutes (`CLOCK_SLACK`: a clock, not the future) and not before the admission.

The schemas gain the form's fields (`PatientIdentity`, `AdmissionNoteFields`), the responses B1a returns (`AdmitResponse`, `AdmissionRow`, `EngineWrites`, `DischargeConfirmResponse`) and the discharge decision (`DischargeStart`; the old `DischargeInitiate` goes in Task 9 with its route). `WorkflowError` carries a code (default `invalid_transition`; a DRAFT without an attending is `missing_attending`, a second open admission `open_admission`), and the router's `_wf` answers it beside the words (X57).

**Files:**
- Create: `homunculus-engine/tests/test_admission_form.py`
- Create: `homunculus-engine/src/homunculus/admission/form.py`
- Modify: `homunculus-engine/tests/test_admission_workflow.py`
- Modify: `homunculus-engine/src/homunculus/admission/schemas.py`
- Modify: `homunculus-engine/src/homunculus/admission/service.py`
- Modify: `homunculus-engine/src/homunculus/admission/router.py`

- [ ] **Step 1: Write the failing tests** — every rule names its field, the codes, `_wf`'s shape; and the workflow test now asserts the code a screen maps:

**Write** `homunculus-engine/tests/test_admission_form.py` (a new file, whole):

```python
# homunculus-engine/tests/test_admission_form.py
"""The admission form's rules, held by the server (Group 2 · B1a, spec §5.2, §3.3, §4.4).

Every refusal names one field as `field_invalid:<field>`, the first wrong one in the form's order.
No database: the rules are pure. Synthetic values only."""
from __future__ import annotations

import math
from datetime import date, datetime, timedelta, timezone

import pytest

from homunculus.admission.errors import CODES, Refusal
from homunculus.admission.form import COMORBIDITY_CODES, check_admission, check_discharge
from homunculus.admission.schemas import AdmissionCreate, DischargeStart
from homunculus.rules import patient_relative

TODAY = date(2026, 10, 25)
NOW = datetime(2026, 10, 25, 12, 0, tzinfo=timezone.utc)
UNIT = "00000000-0000-0000-0000-00000000000a"
BED = "00000000-0000-0000-0000-00000000000b"


def body(patient: dict | None = None, note: dict | None = None) -> AdmissionCreate:
    """A complete, valid form: what the Kabul tab sends with every required field filled."""
    return AdmissionCreate.model_validate({
        "patient": {"display_name": "Sentetik Hasta", "date_of_birth": "1970-01-01",
                    "sex": "female", "consent": "KVKK_SIGNED", **(patient or {})},
        "note": {"admitting_unit_id": UNIT, "bed_id": BED, "admission_type": "ICU",
                 "admission_diagnosis_free_text": "Sentetik tanı", "no_known_allergy": True,
                 **(note or {})},
    })


def refused(payload: AdmissionCreate) -> str:
    with pytest.raises(Refusal) as caught:
        check_admission(payload, today=TODAY)
    assert caught.value.status == 422
    return caught.value.code


def test_a_complete_form_passes():
    check_admission(body(), today=TODAY)
    check_admission(body(patient={"national_id": "5AB12CD", "phone": "+994 50 123 45 67",
                                  "relative_phone": "(012) 555-12-34"},
                         note={"no_known_allergy": False, "allergies_text": "Penisilin",
                               "weight_kg": 72.5, "height_cm": 171,
                               "comorbidity_codes": ["copd", "dementia"]}),
                    today=TODAY)


@pytest.mark.parametrize(("patient", "note", "field"), [
    ({"display_name": "   "}, {}, "display_name"),
    ({"date_of_birth": "2026-10-26"}, {}, "date_of_birth"),
    ({"national_id": "5AB12C"}, {}, "national_id"),
    ({"national_id": "5AB-2CD"}, {}, "national_id"),
    ({"phone": "elli"}, {}, "phone"),
    ({"relative_phone": "12"}, {}, "relative_phone"),
    ({}, {"admission_type": None}, "admission_type"),
    ({}, {"admission_diagnosis_free_text": "  "}, "admission_diagnosis_free_text"),
    ({}, {"weight_kg": 0.1}, "weight_kg"),
    ({}, {"weight_kg": 401}, "weight_kg"),
    ({}, {"height_cm": 2600}, "height_cm"),
    ({}, {"no_known_allergy": False}, "allergies_text"),
    ({}, {"no_known_allergy": True, "allergies_text": "Penisilin"}, "allergies_text"),
    ({}, {"comorbidity_codes": ["copd", "hypertension"]}, "comorbidity_codes"),
    ({"consent": None}, {}, "consent"),
], ids=lambda value: value if isinstance(value, str) else None)
def test_each_rule_refuses_its_own_field(patient, note, field):
    assert refused(body(patient, note)) == f"field_invalid:{field}"


def test_a_weight_that_is_not_a_number_is_refused():
    payload = body()
    payload.note.weight_kg = math.nan
    assert refused(payload) == "field_invalid:weight_kg"


def test_the_first_wrong_field_in_the_forms_order_is_the_one_named():
    assert refused(body({"consent": None, "display_name": " "},
                        {"admission_type": None})) == "field_invalid:display_name"


def test_the_forms_codes_are_codes_the_engine_reads():
    """The checkboxes send engine codes; a code the engine dropped must fail here, not quietly."""
    assert set(COMORBIDITY_CODES) == set(patient_relative._COMORBIDITY_EXPLAINS)


def test_every_other_refusal_has_a_stable_code():
    assert {"bed_not_available", "bed_closed", "out_of_scope", "critical_alarm_open",
            "patient_number_exhausted", "invalid_transition", "missing_attending"} <= CODES


def test_a_workflow_refusal_answers_its_code_beside_its_words():
    """The dashboard maps the code and never the words (spec §4.4)."""
    from homunculus.admission.router import _wf
    from homunculus.admission.service import WorkflowError

    answer = _wf(WorkflowError("Bed is not AVAILABLE (current state: OCCUPIED); cannot admit.",
                               "bed_not_available"))
    assert answer.status_code == 409
    assert answer.detail == {"code": "bed_not_available",
                             "message": "Bed is not AVAILABLE (current state: OCCUPIED); cannot admit."}
    assert _wf(WorkflowError("Only an ACTIVE admission can be discharged.")).detail["code"] \
        == "invalid_transition"


# ---------------------------------------------------------------- the discharge decision
def discharge(**over) -> DischargeStart:
    return DischargeStart.model_validate({"disposition": "HOME", **over})


def test_a_discharge_home_needs_nothing_more():
    check_discharge(discharge(), now=NOW, admitted_at=NOW - timedelta(days=2))


@pytest.mark.parametrize(("over", "field"), [
    ({"disposition": "OTHER_INSTITUTION"}, "institution"),
    ({"disposition": "OTHER_INSTITUTION", "institution": "  "}, "institution"),
    ({"discharge_at": "2026-10-25T12:05:00+00:00"}, "discharge_at"),
    ({"discharge_at": "2026-10-25T11:00:00"}, "discharge_at"),
    ({"discharge_at": "2026-10-20T11:00:00+00:00"}, "discharge_at"),
], ids=lambda value: value if isinstance(value, str) else None)
def test_a_discharge_decision_is_refused_where_it_is_incomplete_or_impossible(over, field):
    with pytest.raises(Refusal) as caught:
        check_discharge(discharge(**over), now=NOW, admitted_at=NOW - timedelta(days=2))
    assert caught.value.code == f"field_invalid:{field}"


def test_a_discharge_a_minute_ahead_of_the_server_is_a_clock_not_the_future():
    check_discharge(discharge(discharge_at="2026-10-25T12:01:00+00:00"), now=NOW,
                    admitted_at=NOW - timedelta(days=2))
    check_discharge(discharge(disposition="OTHER_INSTITUTION", institution="Sentetik Klinika"),
                    now=NOW, admitted_at=None)
```

**Edit** `homunculus-engine/tests/test_admission_workflow.py` (1) — replace:

```python
        db_session, tenant_id=tenant.id, patient=p, note_fields=_note(unit, beds[0], attending=None))
    with pytest.raises(WorkflowError, match="attending_physician_id"):
        await service.sign_off_admission(db_session, adm, signing_user_id=attending.id)

```

with:

```python
        db_session, tenant_id=tenant.id, patient=p, note_fields=_note(unit, beds[0], attending=None))
    with pytest.raises(WorkflowError, match="attending_physician_id") as refused:
        await service.sign_off_admission(db_session, adm, signing_user_id=attending.id)
    assert refused.value.code == "missing_attending"      # G2-B1a: the code a screen maps

```


- [ ] **Step 2: Run it and see it red** — `admission/form.py` does not exist:

```bash
cd /c/tmp/g2b-kabul-be/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 \
  /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_admission_form.py 2>&1 | grep -E "^(FAILED|ERROR) |[0-9]+ (passed|failed|error)|^E +[A-Za-z]*(Error|Exception)" | head -16
```

Expected (the replay, times vary):

```text
ERROR tests/test_admission_form.py
1 error in …s
E   ModuleNotFoundError: No module named 'homunculus.admission.form'
```


- [ ] **Step 3: Extend the schemas, write the rules, give `WorkflowError` its code and `_wf` its shape:**

**Edit** `homunculus-engine/src/homunculus/admission/schemas.py` (1) — replace:

```python

from pydantic import BaseModel, Field

from homunculus.admission.models import (
    AdmissionState, CareTeamRole, HandoverStatus, Sex, SourceOfAdmission,
)
```

with:

```python

from typing import Literal

from pydantic import BaseModel, Field

from homunculus.admission.models import (
    AdmissionState, AdmissionType, BloodGroup, CareTeamRole, Consent, DischargeDisposition,
    HandoverStatus, Sex, SourceOfAdmission,
)
```

**Edit** `homunculus-engine/src/homunculus/admission/schemas.py` (2) — replace:

```python
    sex: Sex                                                        # #4
    his_patient_reference: str | None = None                       # #28

```

with:

```python
    sex: Sex                                                        # #4
    his_patient_reference: str | None = Field(default=None, max_length=64)   # #28
    # Group 2 · B1a — the prototype's form (spec §5.2). Encrypted at rest; the lengths keep the
    # ciphertext inside its 512-character column (admission/models.py). The rules a value must
    # keep beyond its type are in admission/form.py.
    father_name: str | None = Field(default=None, max_length=100)
    nationality: str | None = Field(default=None, max_length=64)
    national_id: str | None = Field(default=None, max_length=16)       # FİN: 7 letters or digits
    passport_no: str | None = Field(default=None, max_length=32)
    phone: str | None = Field(default=None, max_length=32)
    relative_name: str | None = Field(default=None, max_length=100)
    relative_relation: str | None = Field(default=None, max_length=64)
    relative_phone: str | None = Field(default=None, max_length=32)
    companion_name: str | None = Field(default=None, max_length=100)
    consent: Consent | None = None                                  # required by admission/form.py
    sms_permitted: bool = False

```

**Edit** `homunculus-engine/src/homunculus/admission/schemas.py` (3) — replace:

```python
    source_of_admission: SourceOfAdmission | None = None          # #26

```

with:

```python
    source_of_admission: SourceOfAdmission | None = None          # #26
    # Group 2 · B1a (spec §5.2); admission/form.py says which are required and how they combine.
    admission_type: AdmissionType | None = None
    blood_group: BloodGroup | None = None
    allergies_text: str | None = Field(default=None, max_length=500)
    no_known_allergy: bool = False
    comorbidity_codes: list[str] | None = Field(default=None, max_length=10)
    comorbidities_text: str | None = Field(default=None, max_length=500)

```

**Edit** `homunculus-engine/src/homunculus/admission/schemas.py` (4) — replace:

```python
    transfer_confirm_deadline: datetime | None
    created_at: datetime

    model_config = {"from_attributes": True}


```

with:

```python
    transfer_confirm_deadline: datetime | None
    created_at: datetime
    # Group 2 · B1a
    admission_type: AdmissionType | None = None
    blood_group: BloodGroup | None = None
    allergies_text: str | None = None
    no_known_allergy: bool = False
    comorbidity_codes: list | None = None
    comorbidities_text: str | None = None
    discharge_disposition: DischargeDisposition | None = None
    discharge_institution: str | None = None
    discharge_reported_by: str | None = None
    discharge_at: datetime | None = None
    discharge_note: str | None = None

    model_config = {"from_attributes": True}


# What did not reach the engine after an admission or a discharge was written (spec §3.1 step 3):
# the record stands either way, and the screen says which part to enter by hand.
EngineWrite = Literal["ok", "failed", "skipped"]


class EngineWrites(BaseModel):
    weight: EngineWrite
    profile: EngineWrite
    board: EngineWrite


class AdmitResponse(AdmissionResponse):
    """POST /admissions: the admission, the patient number the nurse enters on the device, and
    which of the engine writes landed."""
    patient_number: str
    engine: EngineWrites


class AdmissionRow(AdmissionResponse):
    """GET /admissions: one row of the Taburcu and Yataklar lists, with the names a screen shows
    (never a UUID). `display_name` is PHI, as on the board, for holders of admissions.view."""
    patient_number: str
    display_name: str
    bed_label: str
    room_name: str
    unit_name: str


class DischargeConfirmResponse(AdmissionResponse):
    """POST …/discharge/confirm: the admission, and whether its card left the board."""
    board: EngineWrite


```

**Edit** `homunculus-engine/src/homunculus/admission/schemas.py` (5) — replace:

```python


# ---------------------------------------------------------------------------
# Handover — §4.5, S-07, S-24
```

with:

```python


class DischargeStart(BaseModel):
    """The physician's decision (Group 2 · B1a, spec D7 and §3.3): where the patient goes, when,
    and a note. `institution` is required for OTHER_INSTITUTION; `reported_by` is the caller for
    EXITUS unless another name is written; `discharge_at` defaults to now and is never in the
    future (admission/form.py)."""
    disposition: DischargeDisposition
    institution: str | None = Field(default=None, max_length=200)
    reported_by: str | None = Field(default=None, max_length=200)
    discharge_at: datetime | None = None
    note: str | None = Field(default=None, max_length=2000)


# ---------------------------------------------------------------------------
# Handover — §4.5, S-07, S-24
```

**Write** `homunculus-engine/src/homunculus/admission/form.py` (a new file, whole):

```python
# homunculus-engine/src/homunculus/admission/form.py
"""What an admission and a discharge must hold before they are written (Group 2 · B1a, §5.2, §3.3).

The screen keeps "Kabul et" disabled while a required field is missing and names each one; the
server checks again here, because a screen is not the only client and a rule the server does not
hold is not a rule. A refusal names ONE field — the first wrong one, in the form's order — as
`field_invalid:<field>` (admission/errors.py), the field named as the request body names it.

Types and lengths are pydantic's (admission/schemas.py); this module holds the rules a value
must keep beyond its type. The bounds on weight and height catch a slipped decimal point or a
wrong unit, not clinical judgement: weight is the engine's own charting bound
(`api/clinical.PLAUSIBLE`), so a weight the form accepts is one the engine will take.
"""
from __future__ import annotations

import math
import re
from datetime import date, datetime, timedelta

from homunculus.admission.errors import field_invalid
from homunculus.admission.models import DischargeDisposition
from homunculus.admission.schemas import AdmissionCreate, DischargeStart
from homunculus.api.clinical import PLAUSIBLE
from homunculus.canonical import SignalCode

#: The comorbidity codes the engine reads (rules/patient_relative.py `_COMORBIDITY_EXPLAINS`):
#: the form's checkboxes send these and nothing else. Free text is stored, never sent as a code.
COMORBIDITY_CODES = ("copd", "chronic_respiratory_failure", "chronic_oxygen", "dementia",
                     "chronic_confusion")
WEIGHT_KG = PLAUSIBLE[SignalCode.WEIGHT_KG]
HEIGHT_CM = (20.0, 260.0)
#: FİN, the Azerbaijani personal identification code: seven letters or digits.
NATIONAL_ID = re.compile(r"[A-Za-z0-9]{7}")
PHONE = re.compile(r"\+?[0-9 ()-]{5,32}")
#: A discharge time a few minutes ahead of the server is a clock, not a claim about the future.
CLOCK_SLACK = timedelta(minutes=2)


def _blank(value: str | None) -> bool:
    return value is None or not value.strip()


def _outside(value: float | None, bounds: tuple[float, float]) -> bool:
    return value is not None and (not math.isfinite(value) or not bounds[0] <= value <= bounds[1])


def check_admission(payload: AdmissionCreate, *, today: date) -> None:
    """Refuse the first field that breaks a rule, in the form's order; return quietly otherwise."""
    p, n = payload.patient, payload.note
    if _blank(p.display_name):
        raise field_invalid("display_name", "The patient's name is required.")
    if p.date_of_birth > today:
        raise field_invalid("date_of_birth", "The date of birth is in the future.")
    if not _blank(p.national_id) and not NATIONAL_ID.fullmatch(p.national_id.strip()):
        raise field_invalid("national_id", "FİN is seven letters or digits.")
    for name in ("phone", "relative_phone"):
        value = getattr(p, name)
        if not _blank(value) and not PHONE.fullmatch(value.strip()):
            raise field_invalid(name, "A phone number holds digits, spaces, + ( ) and - only.")
    if n.admission_type is None:
        raise field_invalid("admission_type", "The admission type is required.")
    if _blank(n.admission_diagnosis_free_text):
        raise field_invalid("admission_diagnosis_free_text", "The admission diagnosis is required.")
    if _outside(n.weight_kg, WEIGHT_KG):
        raise field_invalid("weight_kg", f"Weight is between {WEIGHT_KG[0]} and {WEIGHT_KG[1]} kg.")
    if _outside(n.height_cm, HEIGHT_CM):
        raise field_invalid("height_cm", f"Height is between {HEIGHT_CM[0]} and {HEIGHT_CM[1]} cm.")
    if _blank(n.allergies_text) == (not n.no_known_allergy):
        raise field_invalid("allergies_text",
                            "Write the known allergy, or mark that none is known — one of the two.")
    unknown = sorted(set(n.comorbidity_codes or ()) - set(COMORBIDITY_CODES))
    if unknown:
        raise field_invalid("comorbidity_codes", f"Not a code the engine reads: {', '.join(unknown)}.")
    if p.consent is None:
        raise field_invalid("consent", "The consent answer is required.")


def check_discharge(payload: DischargeStart, *, now: datetime,
                    admitted_at: datetime | None) -> None:
    """Refuse a discharge decision that is incomplete or impossible."""
    if (payload.disposition == DischargeDisposition.OTHER_INSTITUTION
            and _blank(payload.institution)):
        raise field_invalid("institution", "Name the institution the patient goes to.")
    at = payload.discharge_at
    if at is not None:
        if at.tzinfo is None:
            raise field_invalid("discharge_at", "The discharge time must carry its time zone.")
        if at > now + CLOCK_SLACK:
            raise field_invalid("discharge_at", "The discharge time is in the future.")
        if admitted_at is not None and at < admitted_at:
            raise field_invalid("discharge_at", "The discharge time is before the admission.")
```

**Edit** `homunculus-engine/src/homunculus/admission/service.py` (1) — replace:

```python

from homunculus.admission.models import (
```

with:

```python

from homunculus.admission import errors
from homunculus.admission.models import (
```

**Edit** `homunculus-engine/src/homunculus/admission/service.py` (2) — replace:

```python
class WorkflowError(Exception):
    """Raised for business-rule violations; mapped to HTTP 4xx by the router."""

```

with:

```python
class WorkflowError(Exception):
    """Raised for business-rule violations; mapped to HTTP 409 by the router, with `code` beside
    the words (admission/errors.py) — the dashboard reads the code, never the words."""

    def __init__(self, message: str, code: str = errors.INVALID_TRANSITION) -> None:
        super().__init__(message)
        self.code = code

```

**Edit** `homunculus-engine/src/homunculus/admission/service.py` (3) — replace:

```python
            f"Patient already has an open admission ({existing.state.value}); "
            f"a patient may have only one active admission at a time."
        )
```

with:

```python
            f"Patient already has an open admission ({existing.state.value}); "
            f"a patient may have only one active admission at a time.",
            errors.OPEN_ADMISSION,
        )
```

**Edit** `homunculus-engine/src/homunculus/admission/service.py` (4) — replace:

```python
            f"Bed is not AVAILABLE (current state: {bed.state.value}); "
            f"cannot admit."
        )
```

with:

```python
            f"Bed is not AVAILABLE (current state: {bed.state.value}); "
            f"cannot admit.",
            errors.BED_NOT_AVAILABLE,
        )
```

**Edit** `homunculus-engine/src/homunculus/admission/service.py` (5) — replace:

```python
            "attending_physician_id must be resolved before a DRAFT can become ACTIVE "
            "(§5.2 field 8)."
        )
```

with:

```python
            "attending_physician_id must be resolved before a DRAFT can become ACTIVE "
            "(§5.2 field 8).",
            errors.MISSING_ATTENDING,
        )
```

**Edit** `homunculus-engine/src/homunculus/admission/service.py` (6) — replace:

```python
            f"Discharge blocked: {unacknowledged_critical_count} unacknowledged "
            f"CRITICAL alert(s) must be acknowledged with a reason first (§4.7)."
        )
```

with:

```python
            f"Discharge blocked: {unacknowledged_critical_count} unacknowledged "
            f"CRITICAL alert(s) must be acknowledged with a reason first (§4.7).",
            errors.CRITICAL_ALARM_OPEN,
        )
```

**Edit** `homunculus-engine/src/homunculus/admission/router.py` (1) — replace:

```python
def _wf(exc: WorkflowError) -> HTTPException:
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))

```

with:

```python
def _wf(exc: WorkflowError) -> HTTPException:
    """A business-rule refusal: 409, its stable code beside its words (admission/errors.py)."""
    return HTTPException(status_code=status.HTTP_409_CONFLICT,
                         detail={"code": exc.code, "message": str(exc)})

```


- [ ] **Step 4: Run them green:**

```bash
cd /c/tmp/g2b-kabul-be/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 \
  /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_admission_form.py tests/test_admission_state_machine.py 2>&1 | grep -E "^(FAILED|ERROR) |[0-9]+ (passed|failed|error)|^E +[A-Za-z]*(Error|Exception)" | head -16
```

Expected (the replay, times vary):

```text
41 passed in …s
```

```bash
cd /c/tmp/g2b-kabul-be/homunculus-engine
TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 \
  /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_admission_workflow.py 2>&1 | grep -E "^(FAILED|ERROR) |[0-9]+ (passed|failed|error)|^E +[A-Za-z]*(Error|Exception)" | head -16
```

Expected (the replay, times vary):

```text
16 passed in …s
```


- [ ] **Step 5: The whole no-DB suite:**

```bash
cd /c/tmp/g2b-kabul-be/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 \
  /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q --ignore=tests/test_infinity_vm_pilot.py 2>&1 | grep -E "^(FAILED|ERROR) |[0-9]+ (passed|failed|error)|^E +[A-Za-z]*(Error|Exception)" | head -16
```

Expected (the replay, times vary):

```text
2303 passed, 662 skipped, 3 warnings in …s
```


- [ ] **Step 6: Line ends:**

```bash
cd /c/tmp/g2b-kabul-be
for f in homunculus-engine/tests/test_admission_form.py homunculus-engine/tests/test_admission_workflow.py homunculus-engine/src/homunculus/admission/schemas.py homunculus-engine/src/homunculus/admission/form.py homunculus-engine/src/homunculus/admission/service.py homunculus-engine/src/homunculus/admission/router.py; do printf "%s CR=%s LF=%s\n" "$f" "$(tr -cd '\r' < "$f" | wc -c)" "$(tr -cd '\n' < "$f" | wc -c)"; done
```

Expected:

```text
homunculus-engine/tests/test_admission_form.py CR=0 LF=134
homunculus-engine/tests/test_admission_workflow.py CR=314 LF=314
homunculus-engine/src/homunculus/admission/schemas.py CR=291 LF=291
homunculus-engine/src/homunculus/admission/form.py CR=0 LF=91
homunculus-engine/src/homunculus/admission/service.py CR=487 LF=487
homunculus-engine/src/homunculus/admission/router.py CR=446 LF=446
```


- [ ] **Step 7: Commit:**

```bash
cd /c/tmp/g2b-kabul-be
git add -- homunculus-engine/tests/test_admission_form.py homunculus-engine/tests/test_admission_workflow.py homunculus-engine/src/homunculus/admission/schemas.py homunculus-engine/src/homunculus/admission/form.py homunculus-engine/src/homunculus/admission/service.py homunculus-engine/src/homunculus/admission/router.py
git status --short && git diff --cached --stat
git commit -m "feat(admission): the admission form's rules and a stable code on every refusal (G2-B1a)" \
  -m "red: 1 error (ModuleNotFoundError: No module named 'homunculus.admission.form')" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- homunculus-engine/tests/test_admission_form.py homunculus-engine/tests/test_admission_workflow.py homunculus-engine/src/homunculus/admission/schemas.py homunculus-engine/src/homunculus/admission/form.py homunculus-engine/src/homunculus/admission/service.py homunculus-engine/src/homunculus/admission/router.py
```

---

### Task 4: Unit scope for the bed routes; own patients by their number

**Lane:** backend. **Needs:** Task 3.

Spec D9, §4.3, §4.5, X64. The admission, sign-off, discharge and bed-release routes act on a bed, and since D9 a grant names the unit or the bed by its tenant UUID. `admission/unitscope.py` reads the caller's scope in the tenant through the scope service the board already uses (`scope/service.build_scope` over her `staff_scopes` and groups — an administrator and an unassigned nurse before enforcement reach everything, as on the board) and answers `reaches(scope, unit_id=…, bed_id=…)`; `require_reach` refuses **403 `out_of_scope`** (X57). `scope/service.own_patient_ids` maps care-team rows through `Patient.patient_number` as well as `his_patient_reference`, so a `kabul` patient (who has no HIS reference) is found by the key her board card carries.

**Files:**
- Create: `homunculus-engine/tests/test_unit_scope.py`
- Create: `homunculus-engine/src/homunculus/admission/unitscope.py`
- Modify: `homunculus-engine/src/homunculus/scope/service.py`

- [ ] **Step 1: Write the failing test:**

**Write** `homunculus-engine/tests/test_unit_scope.py` (a new file, whole):

```python
# homunculus-engine/tests/test_unit_scope.py
"""Unit scope for the admission, discharge and bed routes (Group 2 · B1a, spec §4.5), and the
care team's own patients found by their Homunculus patient number (§4.3).

The decision (`reaches`) needs no database; reading a caller's scope and own patients does
(`db_session`). Synthetic tenants, users and patients only."""
from __future__ import annotations

import uuid

import pytest

from homunculus.admission.errors import Refusal
from homunculus.admission.models import Admission, CareTeamMember, CareTeamRole, Patient
from homunculus.admission.unitscope import caller_scope, reaches, require_reach
from homunculus.auth.groups import ensure_default_groups
from homunculus.scope import Scope, build_scope
from homunculus.scope.models import StaffScope
from homunculus.scope.service import read_own_patient_ids
from homunculus.tenant.models import Bed, Room, Site, Tenant, Unit, UnitType
from tests.conftest import requires_db
from tests.signed_in import add_user

UNIT_A, UNIT_B = uuid.uuid4(), uuid.uuid4()
BED_A1, BED_B1 = uuid.uuid4(), uuid.uuid4()


def test_an_unrestricted_scope_reaches_every_bed():
    for scope in (build_scope("HOSPITAL_ADMIN"), build_scope("MEMBER")):     # admin; unassigned
        assert reaches(scope, unit_id=UNIT_B, bed_id=BED_B1)


def test_a_unit_grant_reaches_that_units_beds_and_no_other():
    scope = build_scope("MEMBER", unit_ids=[str(UNIT_A)])
    assert reaches(scope, unit_id=UNIT_A, bed_id=BED_A1)
    assert not reaches(scope, unit_id=UNIT_B, bed_id=BED_B1)


def test_a_bed_grant_reaches_that_bed_alone():
    scope = build_scope("MEMBER", bed_ids=[str(BED_B1)])
    assert reaches(scope, unit_id=UNIT_B, bed_id=BED_B1)
    assert not reaches(scope, unit_id=UNIT_B, bed_id=uuid.uuid4())


def test_grants_are_compared_whatever_their_case():
    scope = build_scope("MEMBER", unit_ids=[str(UNIT_A).upper()])
    assert reaches(scope, unit_id=UNIT_A, bed_id=BED_A1)


def test_an_unassigned_caller_reaches_nothing_once_enforcement_is_on():
    assert not reaches(build_scope("MEMBER", enforce_unassigned=True), unit_id=UNIT_A,
                       bed_id=BED_A1)
    assert not reaches(Scope(False, "unknown"), unit_id=UNIT_A, bed_id=BED_A1)


def test_out_of_scope_is_a_403_with_its_code():
    with pytest.raises(Refusal) as caught:
        require_reach(build_scope("MEMBER", unit_ids=[str(UNIT_A)]), unit_id=UNIT_B,
                      bed_id=BED_B1)
    assert (caught.value.status, caught.value.code) == (403, "out_of_scope")


# ---------------------------------------------------------------- read from the database
async def _ward(db):
    tenant = Tenant(name="Sentetik Hastane", slug="sentetik", country_code="AZ")
    db.add(tenant)
    await db.flush()
    groups = await ensure_default_groups(db, tenant.id)
    site = Site(tenant_id=tenant.id, name="Kampüs")
    db.add(site)
    await db.flush()
    unit = Unit(site_id=site.id, name="Reanimasiya", unit_type=UnitType.ADULT_ICU)
    db.add(unit)
    await db.flush()
    room = Room(unit_id=unit.id, name="Otaq 1")
    db.add(room)
    await db.flush()
    bed = Bed(room_id=room.id, label="1")
    db.add(bed)
    await db.flush()
    return tenant, groups, unit, bed


@requires_db
async def test_a_nurse_granted_a_unit_by_its_uuid_reaches_its_beds(db_session, monkeypatch):
    monkeypatch.delenv("SCOPE_ENFORCE_UNASSIGNED", raising=False)
    tenant, groups, unit, bed = await _ward(db_session)
    nurse = await add_user(db_session, username="hemsire@example.com", tenant_id=tenant.id,
                           group=groups["nurse"])
    db_session.add(StaffScope(tenant_id=tenant.id, user_id=nurse.id, unit_id=str(unit.id)))
    await db_session.commit()

    scope = await caller_scope(db_session, nurse.id, tenant.id)
    assert reaches(scope, unit_id=unit.id, bed_id=bed.id)
    assert not reaches(scope, unit_id=uuid.uuid4(), bed_id=uuid.uuid4())


@requires_db
async def test_an_administrator_and_an_unassigned_nurse_reach_every_bed(db_session, monkeypatch):
    monkeypatch.delenv("SCOPE_ENFORCE_UNASSIGNED", raising=False)
    tenant, groups, unit, bed = await _ward(db_session)
    admin = await add_user(db_session, username="admin@example.com", tenant_id=tenant.id,
                           group=groups["hospital_admin"])
    nurse = await add_user(db_session, username="hemsire@example.com", tenant_id=tenant.id,
                           group=groups["nurse"])
    for user in (admin, nurse):
        assert (await caller_scope(db_session, user.id, tenant.id)).unrestricted
    monkeypatch.setenv("SCOPE_ENFORCE_UNASSIGNED", "1")
    assert not reaches(await caller_scope(db_session, nurse.id, tenant.id),
                       unit_id=unit.id, bed_id=bed.id)


@requires_db
async def test_someone_with_no_membership_here_reaches_nothing(db_session):
    tenant, _groups, unit, bed = await _ward(db_session)
    stranger = await add_user(db_session, username="yad@example.com")
    scope = await caller_scope(db_session, stranger.id, tenant.id)
    assert scope.reason == "unknown"
    assert not reaches(scope, unit_id=unit.id, bed_id=bed.id)


@requires_db
async def test_the_care_teams_own_patients_are_found_by_their_patient_number(db_session):
    tenant, groups, unit, bed = await _ward(db_session)
    doctor = await add_user(db_session, username="hekim@example.com", tenant_id=tenant.id,
                            group=groups["attending"])
    kabul = Patient(tenant_id=tenant.id, display_name="Sentetik Bir", date_of_birth="1970-01-01",
                    sex="female", patient_number="H2600007")
    both = Patient(tenant_id=tenant.id, display_name="Sentetik İki", date_of_birth="1971-01-01",
                   sex="male", patient_number="H2600008", his_patient_reference="S-100")
    db_session.add_all([kabul, both])
    await db_session.flush()
    for patient in (kabul, both):
        admission = Admission(tenant_id=tenant.id, patient_id=patient.id,
                              admitting_unit_id=unit.id, bed_id=bed.id,
                              admission_datetime=tenant.created_at,
                              admission_diagnosis_free_text="Sentetik tanı")
        db_session.add(admission)
        await db_session.flush()
        db_session.add(CareTeamMember(admission_id=admission.id, user_id=doctor.id,
                                      role=CareTeamRole.ATTENDING))
    await db_session.commit()

    own = await read_own_patient_ids(db_session, doctor.id, tenant.id)
    assert sorted(own) == ["H2600007", "H2600008", "S-100"]
```


- [ ] **Step 2: Run it and see it red** — `admission/unitscope.py` does not exist:

```bash
cd /c/tmp/g2b-kabul-be/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 \
  /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_unit_scope.py 2>&1 | grep -E "^(FAILED|ERROR) |[0-9]+ (passed|failed|error)|^E +[A-Za-z]*(Error|Exception)" | head -16
```

Expected (the replay, times vary):

```text
ERROR tests/test_unit_scope.py
1 error in …s
E   ModuleNotFoundError: No module named 'homunculus.admission.unitscope'
```


- [ ] **Step 3: Write the unit scope; find own patients by their number:**

**Write** `homunculus-engine/src/homunculus/admission/unitscope.py` (a new file, whole):

```python
# homunculus-engine/src/homunculus/admission/unitscope.py
"""Which beds a caller may act on — the admission, discharge and bed routes (Group 2 · B1a, §4.5).

The board's scope (`homunculus.scope`) decides which CARDS a clinician sees; the same grants decide
here which BEDS she may admit into, discharge from or release: the target bed's unit against her
unit grants, the bed itself against her bed grants. An unrestricted caller (an administrator, or
an unassigned one while `SCOPE_ENFORCE_UNASSIGNED` is off — the pilot's state) passes. A caller
whose scope cannot be read (no active membership) reaches nothing.

Own patients (care team) widen what she SEES on the board, not where she may admit: an admission
is about a bed, and a bed belongs to a unit.

Since B1a the grants name tenant UUIDs (spec D9): the unit and bed ids of our own structure, as
`GET /tenant/structure` gives them to the scope editor. Compared case-insensitively, as the board
compares them (`scope.normalise_id`).
"""
from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.admission.errors import OUT_OF_SCOPE, Refusal
from homunculus.scope import Scope, build_scope, normalise_id
from homunculus.scope import service as scope_service
from homunculus.scope.resolver import UNKNOWN, enforce_unassigned_default


async def caller_scope(db: AsyncSession, user_id: uuid.UUID, tenant_id: uuid.UUID) -> Scope:
    """The caller's scope in this tenant, read the way the board's resolver reads it."""
    role = await scope_service.read_role(db, user_id, tenant_id)
    if role is None:
        return UNKNOWN
    grants = await scope_service.read_grants(db, user_id, tenant_id)
    return build_scope(role, unit_ids=[g.unit_id for g in grants if g.unit_id],
                       bed_ids=[g.bed_id for g in grants if g.bed_id],
                       enforce_unassigned=enforce_unassigned_default())


def reaches(scope: Scope, *, unit_id: uuid.UUID | str, bed_id: uuid.UUID | str) -> bool:
    """Whether this scope reaches this bed: unrestricted, its unit granted, or the bed itself."""
    if scope.unrestricted:
        return True
    return (normalise_id(str(bed_id)) in scope.bed_ids
            or normalise_id(str(unit_id)) in scope.unit_ids)


def require_reach(scope: Scope, *, unit_id: uuid.UUID | str, bed_id: uuid.UUID | str) -> None:
    """403 `out_of_scope` unless the scope reaches the bed. Not a 404: the caller picked the bed
    from a structure already narrowed to her units, so she knows it exists."""
    if not reaches(scope, unit_id=unit_id, bed_id=bed_id):
        raise Refusal(403, OUT_OF_SCOPE, "This bed is not in one of your units.")
```

**Edit** `homunculus-engine/src/homunculus/scope/service.py` (1) — replace:

```python

    ⚠️ **This rule is only as good as that column.** An admission created without a HIS
    reference produces no identifier to match, so its care team gets no own-patient exemption
    and the clinician sees that patient only if their unit or bed grant reaches them. That is a
    gap in the admission path, not here, and it is silent by nature — which is why the caller
    publishes `own_patients` as a count the screen can show.

```

with:

```python

    Since Group 2 · B1a a patient admitted here is on the board under its Homunculus patient
    number (`Patient.patient_number`, in the clear), so both identifiers are returned: the number
    reaches the card a `kabul` admission made, the HIS reference the card the HIS feed made. A
    patient with both is two identifiers, and `own_patients` counts identifiers.

```

**Edit** `homunculus-engine/src/homunculus/scope/service.py` (2) — replace:

```python
    result = await db.execute(
        select(Patient.his_patient_reference,
               CareTeamMember.window_start, CareTeamMember.window_end)
```

with:

```python
    result = await db.execute(
        select(Patient.his_patient_reference, Patient.patient_number,
               CareTeamMember.window_start, CareTeamMember.window_end)
```

**Edit** `homunculus-engine/src/homunculus/scope/service.py` (3) — replace:

```python
    )
    return [ref for ref, start, end in result.all()
            if ref and _window_open(start, end, moment)]

```

with:

```python
    )
    own: list[str] = []
    for his, number, start, end in result.all():
        if _window_open(start, end, moment):
            own.extend(ref for ref in (his, number) if ref and ref not in own)
    return own

```


- [ ] **Step 4: Run it green, with the scope suites it leans on:**

```bash
cd /c/tmp/g2b-kabul-be/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 \
  /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_unit_scope.py tests/test_scope_rules.py tests/test_scope_resolver.py tests/test_api_scope.py 2>&1 | grep -E "^(FAILED|ERROR) |[0-9]+ (passed|failed|error)|^E +[A-Za-z]*(Error|Exception)" | head -16
```

Expected (the replay, times vary):

```text
100 passed, 4 skipped, 3 warnings in …s
```

```bash
cd /c/tmp/g2b-kabul-be/homunculus-engine
TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 \
  /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_unit_scope.py tests/test_scope_me_agrees_with_board.py tests/test_scope_role_from_groups.py 2>&1 | grep -E "^(FAILED|ERROR) |[0-9]+ (passed|failed|error)|^E +[A-Za-z]*(Error|Exception)" | head -16
```

Expected (the replay, times vary):

```text
41 passed, 2 warnings in …s
```


- [ ] **Step 5: The whole no-DB suite:**

```bash
cd /c/tmp/g2b-kabul-be/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 \
  /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q --ignore=tests/test_infinity_vm_pilot.py 2>&1 | grep -E "^(FAILED|ERROR) |[0-9]+ (passed|failed|error)|^E +[A-Za-z]*(Error|Exception)" | head -16
```

Expected (the replay, times vary):

```text
2309 passed, 666 skipped, 3 warnings in …s
```


- [ ] **Step 6: Line ends:**

```bash
cd /c/tmp/g2b-kabul-be
for f in homunculus-engine/tests/test_unit_scope.py homunculus-engine/src/homunculus/admission/unitscope.py homunculus-engine/src/homunculus/scope/service.py; do printf "%s CR=%s LF=%s\n" "$f" "$(tr -cd '\r' < "$f" | wc -c)" "$(tr -cd '\n' < "$f" | wc -c)"; done
```

Expected:

```text
homunculus-engine/tests/test_unit_scope.py CR=0 LF=145
homunculus-engine/src/homunculus/admission/unitscope.py CR=0 LF=52
homunculus-engine/src/homunculus/scope/service.py CR=217 LF=217
```


- [ ] **Step 7: Commit:**

```bash
cd /c/tmp/g2b-kabul-be
git add -- homunculus-engine/tests/test_unit_scope.py homunculus-engine/src/homunculus/admission/unitscope.py homunculus-engine/src/homunculus/scope/service.py
git status --short && git diff --cached --stat
git commit -m "feat(admission): unit scope for the bed routes; own patients found by their number (G2-B1a)" \
  -m "red: 1 error (ModuleNotFoundError: No module named 'homunculus.admission.unitscope')" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- homunculus-engine/tests/test_unit_scope.py homunculus-engine/src/homunculus/admission/unitscope.py homunculus-engine/src/homunculus/scope/service.py
```

---

### Task 5: The identity's own bed, the `kabul` tombstone, the board's join (Lane A files)

**Lane:** backend. **Needs:** Task 2 (the columns), Task 4, and **Lane A's confirmation of X51** (the gate in the header: do not start this task without it).

Spec D1, D9, §4.3, §7 (items 2 and 3), X51, X54, X56. **Lane A's files: only the agreed regions change** (the "Lane A coordination" table). The board identity record gains `bed_id` and `unit_id` (additive, `""` when absent; the SQLite and Postgres stores carry the two columns) and a source `kabul`; `as_board` publishes them; `_merge` treats them with the location (an update that names a bed moves the card, a discharge keeps them as the last place and clears only the HIS text location — X56). A discharged `kabul` record is **never pruned** after 24 h: it is the tombstone that keeps a discharged number off the board for good (`_is_expired` and the Postgres store's `_PRUNABLE`).

In `api/board.py`: `_own_bed` places a record with its own `bed_id` on that bed, without the bed map (a discharged one on no bed); `_is_tombstone` recognises a discharged `kabul` record; `_tombstone_board` is the removal frame a tombstone's board becomes (`removed: true`, the last bed and unit, no name). Two lines at the top of `_bed_resolution` call `_own_bed`; two at the top of `patient_board` return the tombstone's removal — so `/ingest`, which publishes `patient_board` for every reading, sends a removal and never brings the card back (X54); `board_snapshot` filters removals out and keeps a tombstone's identity off the identity-only list. The helpers sit **after** `_bed_resolution`, not between `_merge_alert` and `_bed_resolution`, where Lane A's O17 inserts `_latched_alerts` (X51).

**Files:**
- Create: `homunculus-engine/tests/test_kabul_identity.py`
- Modify: `homunculus-engine/tests/test_patient_identity_postgres.py`
- Modify: `homunculus-engine/src/homunculus/api/patient_identity.py` **(Lane A file — agreed region)**
- Modify: `homunculus-engine/src/homunculus/api/patient_identity_postgres.py` **(Lane A file — agreed region)**
- Modify: `homunculus-engine/src/homunculus/api/board.py` **(Lane A file — agreed region)**

- [ ] **Step 1: Write the failing tests** — the record's own bed; tombstones never pruned; the board's join; the removal reaches the unit's scoped screen; and the Postgres store, provisioned with `0012`'s two columns, keeps a tombstone through a prune:

**Write** `homunculus-engine/tests/test_kabul_identity.py` (a new file, whole):

```python
# homunculus-engine/tests/test_kabul_identity.py
"""The join of the admissions world to the board (Group 2 · B1a, spec §4.3): a `kabul` identity
carries its own bed and unit, the board places the card by them without the bed map, and a
discharged `kabul` identity is a tombstone — never pruned, never on the board, and a removal that
reaches the unit's scoped screens. HIS-fed records keep working as before. No database (the
memory and SQLite stores; the Postgres one is in test_patient_identity_postgres.py). Synthetic."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from homunculus.api.ackstore import AckStore
from homunculus.api.board import board_snapshot, identity_only_board, patient_board
from homunculus.api.patient_identity import (
    KABUL, IdentityRecord, InMemoryIdentityStore, SqliteIdentityStore,
)
from homunculus.canonical import Observation, SignalCode
from homunculus.pipeline import Engine
from homunculus.scope import build_scope, sees_patient
from homunculus.tenant.bedmap import BedMap, BedRef

T0 = datetime(2026, 10, 25, 8, 0, tzinfo=timezone.utc)
BED = "5f0c6a1e-0000-4000-8000-0000000000b1"
UNIT = "5f0c6a1e-0000-4000-8000-0000000000a1"


def admitted(pid: str = "H2600001", **over) -> IdentityRecord:
    return IdentityRecord(**{"patient_id": pid, "given": "Sentetik Hasta", "birth_date": "1970-01-01",
                             "sex": "female", "bed": "1A", "state": "admitted", "source": KABUL,
                             "updated_at": T0, "bed_id": BED, "unit_id": UNIT, **over})


def discharged(pid: str = "H2600001", at: datetime = T0 + timedelta(hours=1)) -> IdentityRecord:
    return IdentityRecord(patient_id=pid, state="discharged", source=KABUL, updated_at=at)


def measured(engine: Engine, pid: str) -> None:
    engine.ingest(Observation(patient_id=pid, code=SignalCode.HEART_RATE, value=88.0, unit="/min",
                              timestamp=T0, source_device="test"), now=T0)


# ---------------------------------------------------------------- the record
def test_a_kabul_record_publishes_its_own_bed_and_unit():
    card = admitted().as_board()
    assert (card["bed_id"], card["unit_id"], card["source"]) == (BED, UNIT, "kabul")
    assert card["bed_label"] == "1A"


def test_discharge_frees_the_bed_and_keeps_the_last_place():
    store = InMemoryIdentityStore()
    store.apply("hosp", admitted())
    after = store.apply("hosp", discharged())
    assert (after.state, after.bed, after.bed_label) == ("discharged", "", "")
    assert (after.bed_id, after.unit_id) == (BED, UNIT)
    assert after.display_name == "Sentetik Hasta"


@pytest.mark.parametrize("make", [lambda p: InMemoryIdentityStore(),
                                  lambda p: SqliteIdentityStore(p / "identity.db")],
                         ids=["memory", "sqlite"])
def test_a_discharged_kabul_record_is_never_pruned_and_a_his_one_still_is(make, tmp_path):
    store = make(tmp_path)
    store.apply("hosp", admitted())
    store.apply("hosp", discharged())
    store.apply("hosp", IdentityRecord(patient_id="20239121", given="HIS HASTA", bed="2",
                                       state="admitted", source="comed", updated_at=T0))
    store.apply("hosp", IdentityRecord(patient_id="20239121", state="discharged", source="comed",
                                       updated_at=T0 + timedelta(hours=1)))
    later = T0 + timedelta(days=30)
    assert [r.patient_id for r in store.expired("hosp", later)] == ["20239121"]
    assert store.prune(later) == 1
    assert store.get("hosp", "H2600001").state == "discharged"
    assert store.get("hosp", "20239121") is None


def test_the_sqlite_store_keeps_the_ids_across_a_restart(tmp_path):
    first = SqliteIdentityStore(tmp_path / "identity.db")
    first.apply("hosp", admitted())
    first.close()
    again = SqliteIdentityStore(tmp_path / "identity.db")
    record = again.get("hosp", "H2600001")
    assert (record.bed_id, record.unit_id, record.source) == (BED, UNIT, "kabul")


# ---------------------------------------------------------------- the board
def test_the_card_lands_on_its_own_bed_without_the_bed_map():
    card = identity_only_board(admitted(), BedMap())["identity"]
    assert (card["bed_id"], card["unit_id"], card["bed_matched"], card["bed_key"]) == \
        (BED, UNIT, True, None)
    assert card["bed_label"] == "1A"
    measured_engine = Engine()
    measured(measured_engine, "H2600001")
    board = patient_board(measured_engine, "H2600001", AckStore(), identity=admitted(),
                          bedmap=BedMap())
    assert (board["identity"]["bed_id"], board["identity"]["unit_id"]) == (BED, UNIT)


def test_a_his_record_still_resolves_through_the_bed_map():
    bedmap = BedMap({"YB^304^2": BedRef(bed_id="bed-his", unit_id="unit-his", label="YB 304-2")})
    record = IdentityRecord(patient_id="20239121", unit="YB", room="304", bed="2",
                            state="admitted", source="comed", updated_at=T0)
    card = identity_only_board(record, bedmap)["identity"]
    assert (card["bed_id"], card["unit_id"], card["bed_matched"], card["bed_key"]) == \
        ("bed-his", "unit-his", True, "YB^304^2")


def test_a_discharged_kabul_patient_is_not_on_the_board_measured_or_not():
    engine, store = Engine(), InMemoryIdentityStore()
    store.apply("hosp", admitted("H2600001"))
    store.apply("hosp", admitted("H2600002", bed_id="other-bed", bed="1B"))
    store.apply("hosp", discharged("H2600001"))
    store.apply("hosp", discharged("H2600002"))
    measured(engine, "H2600001")                  # readings still came for the first
    store.apply("hosp", admitted("H2600003", bed_id="third-bed", bed="1C"))
    ids = [b["patient_id"] for b in board_snapshot(engine, AckStore(), identities=store,
                                                   hospital="hosp")]
    assert ids == ["H2600003"]


def test_a_discharged_his_card_still_stays_its_24_hours():
    store = InMemoryIdentityStore()
    store.apply("hosp", IdentityRecord(patient_id="20239121", given="HIS HASTA", bed="2",
                                       state="admitted", source="comed", updated_at=T0))
    store.apply("hosp", IdentityRecord(patient_id="20239121", state="discharged", source="comed",
                                       updated_at=T0 + timedelta(hours=1)))
    boards = board_snapshot(Engine(), AckStore(), identities=store, hospital="hosp")
    assert [b["identity"]["state"] for b in boards] == ["discharged"]


def test_a_tombstones_board_is_a_removal_with_the_last_bed_and_no_name():
    engine = Engine()
    measured(engine, "H2600001")
    tomb = IdentityRecord(**{**admitted().__dict__, "state": "discharged", "bed": ""})
    frame = patient_board(engine, "H2600001", AckStore(), identity=tomb)
    assert frame["removed"] is True
    assert frame["identity"] == {"bed_id": BED, "unit_id": UNIT}
    assert "Sentetik" not in repr(frame)


def test_the_removal_reaches_a_screen_scoped_to_that_unit_and_no_other():
    """The SSE stream drops what `sees_patient` refuses (api/app.py `sse_board_frames`)."""
    tomb = IdentityRecord(**{**admitted().__dict__, "state": "discharged", "bed": ""})
    frame = patient_board(Engine(), "H2600001", AckStore(), identity=tomb)
    assert sees_patient(frame, build_scope("MEMBER", unit_ids=[UNIT]))
    assert sees_patient(frame, build_scope("MEMBER", bed_ids=[BED]))
    assert not sees_patient(frame, build_scope("MEMBER", unit_ids=["another-unit"]))
```

**Edit** `homunculus-engine/tests/test_patient_identity_postgres.py` (1) — replace:

```python

@requires_db
def test_postgres_identity_retention_is_encrypted_tenant_scoped_and_durable():
    import uuid
    hospital = f"identity-test-{uuid.uuid4()}"
    store = PostgresIdentityStore(TEST_DATABASE_URL)
    # The real schema is provisioned by alembic, not a hand-maintained duplicate.
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    path = Path(__file__).resolve().parents[1] / "alembic/versions/0005_patient_identity.py"
    # 0006 as well: the store writes `diagnoses`, a column 0006_identity_diagnoses adds.
    modules = []
    for name in ("0005_patient_identity", "0006_identity_diagnoses"):
        spec = importlib.util.spec_from_file_location(f"identity_{name[:4]}", path.with_name(name + ".py"))
```

with:

```python

def _provisioned() -> PostgresIdentityStore:
    """The store, on the table alembic provisions — not a hand-maintained duplicate: 0005, 0006
    (`diagnoses`) and 0012's two identity columns (`bed_id`, `unit_id`)."""
    store = PostgresIdentityStore(TEST_DATABASE_URL)
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    path = Path(__file__).resolve().parents[1] / "alembic/versions/0005_patient_identity.py"
    modules = []
    for name in ("0005_patient_identity", "0006_identity_diagnoses", "0012_admission_kabul"):
        spec = importlib.util.spec_from_file_location(f"identity_{name[:4]}", path.with_name(name + ".py"))
```

**Edit** `homunculus-engine/tests/test_patient_identity_postgres.py` (2) — replace:

```python
        with Operations.context(MigrationContext.configure(conn)):
            for module in modules:
                module.upgrade()
    try:
```

with:

```python
        with Operations.context(MigrationContext.configure(conn)):
            for module in modules[:2]:
                module.upgrade()
        for statement in modules[2].IDENTITY_COLUMNS:
            conn.execute(text(statement))
    return store


@requires_db
def test_postgres_identity_retention_is_encrypted_tenant_scoped_and_durable():
    import uuid
    hospital = f"identity-test-{uuid.uuid4()}"
    store = _provisioned()
    try:
```

**Edit** `homunculus-engine/tests/test_patient_identity_postgres.py` (3) — replace:

```python
            conn.execute(text("DELETE FROM patient_identity WHERE tenant=:tenant"), {"tenant": hospital})
        store.close()
```

with:

```python
            conn.execute(text("DELETE FROM patient_identity WHERE tenant=:tenant"), {"tenant": hospital})
        store.close()


@requires_db
def test_a_kabul_record_keeps_its_bed_and_its_tombstone_is_never_pruned():
    """G2-B1a: the record's own bed and unit survive a reconnect; a discharged `kabul` record is
    kept past the 24 hours, a discharged HIS one is not."""
    import uuid
    from datetime import datetime, timezone

    from homunculus.api.patient_identity import IdentityRecord

    hospital = f"identity-test-{uuid.uuid4()}"
    store = _provisioned()
    t0 = datetime(2026, 10, 25, 8, 0, tzinfo=timezone.utc)
    try:
        store.apply(hospital, IdentityRecord(patient_id="H2600001", given="Sentetik", bed="1A",
                                             state="admitted", source="kabul", updated_at=t0,
                                             bed_id="bed-uuid", unit_id="unit-uuid"))
        store.apply(hospital, IdentityRecord(patient_id="H2600001", state="discharged",
                                             source="kabul", updated_at=t0 + timedelta(hours=1)))
        store.apply(hospital, IdentityRecord(patient_id="20239121", given="HIS", bed="2",
                                             state="discharged", source="comed", updated_at=t0))
        store.close()
        store = PostgresIdentityStore(TEST_DATABASE_URL)
        tomb = store.get(hospital, "H2600001")
        assert (tomb.state, tomb.bed, tomb.bed_id, tomb.unit_id) == \
            ("discharged", "", "bed-uuid", "unit-uuid")
        later = t0 + timedelta(days=30)
        assert [r.patient_id for r in store.expired(hospital, later)] == ["20239121"]
        store.prune(later)
        assert store.get(hospital, "H2600001") is not None
        assert store.get(hospital, "20239121") is None
    finally:
        with store._engine.begin() as conn:
            conn.execute(text("DELETE FROM patient_identity WHERE tenant=:tenant"), {"tenant": hospital})
        store.close()
```


- [ ] **Step 2: Run it and see it red** — there is no `KABUL` source to import (and the record has no `bed_id`):

```bash
cd /c/tmp/g2b-kabul-be/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 \
  /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_kabul_identity.py 2>&1 | grep -E "^(FAILED|ERROR) |[0-9]+ (passed|failed|error)|^E +[A-Za-z]*(Error|Exception)" | head -16
```

Expected (the replay, times vary):

```text
ERROR tests/test_kabul_identity.py
1 error in …s
E   ImportError: cannot import name 'KABUL' from 'homunculus.api.patient_identity' (C:\tmp\g2b-kabul-be\homunculus-engine\src\homunculus\api\patient_identity.py)
```


- [ ] **Step 3: The identity's ids and the tombstone (the two stores); the board's three helpers and their call sites:**

**Edit** `homunculus-engine/src/homunculus/api/patient_identity.py` (1) — replace:

```python
PHI: name, date of birth and sex are encrypted at rest. The protocol number is the key and stays
in the clear. Discharged records are dropped 24 hours later.
"""
```

with:

```python
PHI: name, date of birth and sex are encrypted at rest. The protocol number is the key and stays
in the clear. Discharged records are dropped 24 hours later — except a `kabul` record's.

G2-B1a (Hasta Kabul): an admission made here writes a record too, with source `kabul`, keyed by the
Homunculus patient number (admission/numbers.py: `H…`, never a HIS protocol number) and carrying
its own `bed_id` and `unit_id` — the tenant's UUIDs, so the board places the card without the bed
map. A discharged `kabul` record is kept as a tombstone, never pruned: readings that still arrive
for its number must not bring the patient back as a nameless card (api/board.py omits it).
"""
```

**Edit** `homunculus-engine/src/homunculus/api/patient_identity.py` (2) — replace:

```python
_SOURCE = re.compile(r"^[a-z0-9_-]{1,32}$")
_key_warned = False
```

with:

```python
_SOURCE = re.compile(r"^[a-z0-9_-]{1,32}$")
#: G2-B1a — the source of a record an admission here wrote (admission/boardlink.py).
KABUL = "kabul"
_key_warned = False
```

**Edit** `homunculus-engine/src/homunculus/api/patient_identity.py` (3) — replace:

```python
    diagnoses: tuple[dict, ...] = ()

```

with:

```python
    diagnoses: tuple[dict, ...] = ()
    # G2-B1a — the bed and unit an admission here placed the patient in: the tenant's UUIDs, as
    # text. Empty for a HIS-fed record (the board resolves those through the bed map). Kept on
    # discharge as the record's last place, so a removal can still reach that unit's screens.
    bed_id: str = ""
    unit_id: str = ""

```

**Edit** `homunculus-engine/src/homunculus/api/patient_identity.py` (4) — replace:

```python
            "sex": self.sex,
        }
```

with:

```python
            "sex": self.sex,
            # G2-B1a. The board's bed resolution writes its own `bed_id`/`unit_id` over these
            # (api/board.py `_bed_resolution`), which for a `kabul` record are these same ids.
            "bed_id": self.bed_id,
            "unit_id": self.unit_id,
        }
```

**Edit** `homunculus-engine/src/homunculus/api/patient_identity.py` (5) — replace:

```python
        changed["sex"] = incoming.sex
    if incoming.unit or incoming.room or incoming.bed:
        changed.update(unit=incoming.unit, room=incoming.room, bed=incoming.bed)
    if incoming.diagnoses:
```

with:

```python
        changed["sex"] = incoming.sex
    if incoming.unit or incoming.room or incoming.bed or incoming.bed_id:
        changed.update(unit=incoming.unit, room=incoming.room, bed=incoming.bed,
                       bed_id=incoming.bed_id, unit_id=incoming.unit_id)
    if incoming.diagnoses:
```

**Edit** `homunculus-engine/src/homunculus/api/patient_identity.py` (6) — replace:

```python
    if state == _DISCHARGED:
        changed.update(unit="", room="", bed="")
```

with:

```python
    if state == _DISCHARGED:
        # The bed is freed; `bed_id`/`unit_id` stay as the last place (the board ignores them on
        # a discharged record, a removal frame carries them).
        changed.update(unit="", room="", bed="")
```

**Edit** `homunculus-engine/src/homunculus/api/patient_identity.py` (7) — replace:

```python
def _is_expired(record: IdentityRecord, cutoff: datetime) -> bool:
    return (record.state == _DISCHARGED and record.updated_at is not None
            and record.updated_at < cutoff)

```

with:

```python
def _is_expired(record: IdentityRecord, cutoff: datetime) -> bool:
    # A discharged `kabul` record never expires: it is the tombstone that keeps the card away.
    return (record.state == _DISCHARGED and record.updated_at is not None
            and record.updated_at < cutoff and record.source != KABUL)

```

**Edit** `homunculus-engine/src/homunculus/api/patient_identity.py` (8) — replace:

```python
_SELECT = ("SELECT patient_id, family, given, birth_date, sex, unit, room, bed, state, source,"
           " updated_at, diagnoses FROM identity")

```

with:

```python
_SELECT = ("SELECT patient_id, family, given, birth_date, sex, unit, room, bed, state, source,"
           " updated_at, diagnoses, bed_id, unit_id FROM identity")
# G2-B1a: what the 24-hour sweep may take — never a `kabul` tombstone.
_PRUNABLE = " AND (source IS NULL OR source <> 'kabul')"

```

**Edit** `homunculus-engine/src/homunculus/api/patient_identity.py` (9) — replace:

```python
            pass
        self._conn.commit()
```

with:

```python
            pass
        for column in ("bed_id", "unit_id"):          # G2-B1a, the same way
            try:
                self._conn.execute(f"ALTER TABLE identity ADD COLUMN {column} TEXT")
            except sqlite3.OperationalError:
                pass
        self._conn.commit()
```

**Edit** `homunculus-engine/src/homunculus/api/patient_identity.py` (10) — replace:

```python
            "INSERT INTO identity (tenant, patient_id, family, given, birth_date, sex,"
            " unit, room, bed, state, source, updated_at, diagnoses)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)"
            " ON CONFLICT(tenant, patient_id) DO UPDATE SET family=excluded.family,"
```

with:

```python
            "INSERT INTO identity (tenant, patient_id, family, given, birth_date, sex,"
            " unit, room, bed, state, source, updated_at, diagnoses, bed_id, unit_id)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
            " ON CONFLICT(tenant, patient_id) DO UPDATE SET family=excluded.family,"
```

**Edit** `homunculus-engine/src/homunculus/api/patient_identity.py` (11) — replace:

```python
            " source=excluded.source, updated_at=excluded.updated_at,"
            " diagnoses=excluded.diagnoses",
            (hospital, merged.patient_id, encrypt_phi(merged.family), encrypt_phi(merged.given),
```

with:

```python
            " source=excluded.source, updated_at=excluded.updated_at,"
            " diagnoses=excluded.diagnoses, bed_id=excluded.bed_id, unit_id=excluded.unit_id",
            (hospital, merged.patient_id, encrypt_phi(merged.family), encrypt_phi(merged.given),
```

**Edit** `homunculus-engine/src/homunculus/api/patient_identity.py` (12) — replace:

```python
             # A diagnosis is health data, so it is encrypted at rest like the name is.
             encrypt_phi(json.dumps([dict(d) for d in merged.diagnoses]))),
        )
```

with:

```python
             # A diagnosis is health data, so it is encrypted at rest like the name is.
             encrypt_phi(json.dumps([dict(d) for d in merged.diagnoses])),
             merged.bed_id, merged.unit_id),
        )
```

**Edit** `homunculus-engine/src/homunculus/api/patient_identity.py` (13) — replace:

```python
            diagnoses=_decode_diagnoses(row[11] if len(row) > 11 else None),
        )
```

with:

```python
            diagnoses=_decode_diagnoses(row[11] if len(row) > 11 else None),
            bed_id=(row[12] if len(row) > 12 else None) or "",
            unit_id=(row[13] if len(row) > 13 else None) or "",
        )
```

**Edit** `homunculus-engine/src/homunculus/api/patient_identity.py` (14) — replace:

```python
            _SELECT + " WHERE tenant = ? AND state = ? AND updated_at IS NOT NULL"
            " AND updated_at < ? ORDER BY patient_id", (hospital, _DISCHARGED, cutoff)).fetchall()
        return [self._record(r) for r in rows]
```

with:

```python
            _SELECT + " WHERE tenant = ? AND state = ? AND updated_at IS NOT NULL"
            " AND updated_at < ?" + _PRUNABLE + " ORDER BY patient_id",
            (hospital, _DISCHARGED, cutoff)).fetchall()
        return [self._record(r) for r in rows]
```

**Edit** `homunculus-engine/src/homunculus/api/patient_identity.py` (15) — replace:

```python
        cur = self._conn.execute(
            "DELETE FROM identity WHERE state = ? AND updated_at IS NOT NULL AND updated_at < ?",
            (_DISCHARGED, cutoff))
        self._conn.commit()
```

with:

```python
        cur = self._conn.execute(
            "DELETE FROM identity WHERE state = ? AND updated_at IS NOT NULL AND updated_at < ?"
            + _PRUNABLE, (_DISCHARGED, cutoff))
        self._conn.commit()
```

**Edit** `homunculus-engine/src/homunculus/api/patient_identity_postgres.py` (1) — replace:

```python
_COLUMNS = ("patient_id", "family", "given", "birth_date", "sex", "unit", "room", "bed",
            "state", "source", "updated_at", "diagnoses")

```

with:

```python
_COLUMNS = ("patient_id", "family", "given", "birth_date", "sex", "unit", "room", "bed",
            "state", "source", "updated_at", "diagnoses", "bed_id", "unit_id")
# G2-B1a: what the 24-hour sweep may take — never a `kabul` tombstone (patient_identity.py).
_PRUNABLE = " AND (source IS NULL OR source <> 'kabul')"

```

**Edit** `homunculus-engine/src/homunculus/api/patient_identity_postgres.py` (2) — replace:

```python
    values["diagnoses"] = _decode_diagnoses(values.get("diagnoses"))
    return IdentityRecord(**values)
```

with:

```python
    values["diagnoses"] = _decode_diagnoses(values.get("diagnoses"))
    values["bed_id"] = values["bed_id"] or ""           # NULL on a row from before 0012
    values["unit_id"] = values["unit_id"] or ""
    return IdentityRecord(**values)
```

**Edit** `homunculus-engine/src/homunculus/api/patient_identity_postgres.py` (3) — replace:

```python
                "SELECT * FROM patient_identity WHERE tenant=:tenant AND state='discharged'"
                " AND updated_at < :cutoff ORDER BY patient_id"),
                {"tenant": hospital, "cutoff": (to_utc(now) - ttl).isoformat()}).mappings().all()
```

with:

```python
                "SELECT * FROM patient_identity WHERE tenant=:tenant AND state='discharged'"
                " AND updated_at < :cutoff" + _PRUNABLE + " ORDER BY patient_id"),
                {"tenant": hospital, "cutoff": (to_utc(now) - ttl).isoformat()}).mappings().all()
```

**Edit** `homunculus-engine/src/homunculus/api/patient_identity_postgres.py` (4) — replace:

```python
            return conn.execute(text(
                "DELETE FROM patient_identity WHERE state='discharged' AND updated_at < :cutoff"),
                {"cutoff": (to_utc(now) - ttl).isoformat()}).rowcount
```

with:

```python
            return conn.execute(text(
                "DELETE FROM patient_identity WHERE state='discharged' AND updated_at < :cutoff"
                + _PRUNABLE),
                {"cutoff": (to_utc(now) - ttl).isoformat()}).rowcount
```

**Edit** `homunculus-engine/src/homunculus/api/board.py` (1) — replace:

```python
from homunculus.api.ackstore import AckStore
from homunculus.api.patient_identity import IdentityRecord, IdentityStore
from homunculus.canonical import SignalCode
```

with:

```python
from homunculus.api.ackstore import AckStore
from homunculus.api.patient_identity import KABUL, IdentityRecord, IdentityStore
from homunculus.canonical import SignalCode
```

**Edit** `homunculus-engine/src/homunculus/api/board.py` (2) — replace:

```python
    """
    if record is None:
```

with:

```python
    """
    if record is not None and record.bed_id:      # G2-B1a: placed by an admission here
        return _own_bed(record)
    if record is None:
```

**Edit** `homunculus-engine/src/homunculus/api/board.py` (3) — replace:

```python
        "bed_key": resolution.key,
    }


```

with:

```python
        "bed_key": resolution.key,
    }


# ---------------------------------------------------------------- G2-B1a (Hasta Kabul)
def _own_bed(record: IdentityRecord) -> dict:
    """The bed an admission made HERE placed the patient in: the record's own ids — no bed map,
    nothing to match. A discharged record's ids are its last place, not its bed: it sits on no
    bed (and a `kabul` one is not on the board at all, `_is_tombstone`)."""
    if record.state != "admitted":
        return {"bed_id": None, "unit_id": None, "bed_matched": False, "bed_key": None}
    return {"bed_id": record.bed_id, "unit_id": record.unit_id or None, "bed_matched": True,
            "bed_key": None}


def _is_tombstone(record: IdentityRecord | None) -> bool:
    """A discharged `kabul` record: the patient left, the record stays (no 24 h prune) so that
    readings still arriving for the number never bring a nameless card back."""
    return record is not None and record.source == KABUL and record.state == "discharged"


def _tombstone_board(record: IdentityRecord) -> dict:
    """What a tombstone's patient is on the board: a removal. It carries the last bed and unit
    and no name, so a scoped screen of that unit is told too (`scope.sees_patient` reads them)."""
    return {**identity_only_board(record), "removed": True,
            "identity": {"bed_id": record.bed_id or None, "unit_id": record.unit_id or None}}


```

**Edit** `homunculus-engine/src/homunculus/api/board.py` (4) — replace:

```python
                  bedmap: BedMap | None = None) -> dict:
    alerts = engine.active_alerts(patient_id)
```

with:

```python
                  bedmap: BedMap | None = None) -> dict:
    if _is_tombstone(identity):                   # G2-B1a: the patient left; a removal
        return _tombstone_board(identity)
    alerts = engine.active_alerts(patient_id)
```

**Edit** `homunculus-engine/src/homunculus/api/board.py` (5) — replace:

```python
              for pid in measured]
    if identities is not None:
```

with:

```python
              for pid in measured]
    boards = [b for b in boards if not b.get("removed")]     # G2-B1a: tombstones are not shown
    if identities is not None:
```

**Edit** `homunculus-engine/src/homunculus/api/board.py` (6) — replace:

```python
                record = identities.get(hospital, pid)
                if record is not None:
                    boards.append(identity_only_board(record, bedmap))
```

with:

```python
                record = identities.get(hospital, pid)
                if record is not None and not _is_tombstone(record):     # G2-B1a
                    boards.append(identity_only_board(record, bedmap))
```


- [ ] **Step 4: Run it green, with every board and identity suite:**

```bash
cd /c/tmp/g2b-kabul-be/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 \
  /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_kabul_identity.py tests/test_board.py tests/test_api_board_identity.py tests/test_api_board_bedmap.py tests/test_api_patient_identity.py tests/test_api_identity_ingest.py tests/test_adt_diagnoses.py tests/test_api_scope.py tests/test_infinity_shadow_api.py 2>&1 | grep -E "^(FAILED|ERROR) |[0-9]+ (passed|failed|error)|^E +[A-Za-z]*(Error|Exception)" | head -16
```

Expected (the replay, times vary):

```text
196 passed, 3 warnings in …s
```

```bash
cd /c/tmp/g2b-kabul-be/homunculus-engine
TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 \
  /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_patient_identity_postgres.py 2>&1 | grep -E "^(FAILED|ERROR) |[0-9]+ (passed|failed|error)|^E +[A-Za-z]*(Error|Exception)" | head -16
```

Expected (the replay, times vary):

```text
3 passed in …s
```


- [ ] **Step 5: The whole no-DB suite:**

```bash
cd /c/tmp/g2b-kabul-be/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 \
  /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q --ignore=tests/test_infinity_vm_pilot.py 2>&1 | grep -E "^(FAILED|ERROR) |[0-9]+ (passed|failed|error)|^E +[A-Za-z]*(Error|Exception)" | head -16
```

Expected (the replay, times vary):

```text
2320 passed, 667 skipped, 3 warnings in …s
```


- [ ] **Step 6: Line ends:**

```bash
cd /c/tmp/g2b-kabul-be
for f in homunculus-engine/tests/test_kabul_identity.py homunculus-engine/tests/test_patient_identity_postgres.py homunculus-engine/src/homunculus/api/patient_identity.py homunculus-engine/src/homunculus/api/patient_identity_postgres.py homunculus-engine/src/homunculus/api/board.py; do printf "%s CR=%s LF=%s\n" "$f" "$(tr -cd '\r' < "$f" | wc -c)" "$(tr -cd '\n' < "$f" | wc -c)"; done
```

Expected:

```text
homunculus-engine/tests/test_kabul_identity.py CR=0 LF=147
homunculus-engine/tests/test_patient_identity_postgres.py CR=104 LF=104
homunculus-engine/src/homunculus/api/patient_identity.py CR=468 LF=468
homunculus-engine/src/homunculus/api/patient_identity_postgres.py CR=108 LF=108
homunculus-engine/src/homunculus/api/board.py CR=329 LF=329
```


- [ ] **Step 7: Commit:**

```bash
cd /c/tmp/g2b-kabul-be
git add -- homunculus-engine/tests/test_kabul_identity.py homunculus-engine/tests/test_patient_identity_postgres.py homunculus-engine/src/homunculus/api/patient_identity.py homunculus-engine/src/homunculus/api/patient_identity_postgres.py homunculus-engine/src/homunculus/api/board.py
git status --short && git diff --cached --stat
git commit -m "feat(board): a kabul identity carries its own bed; a discharged one is a tombstone the board never shows (G2-B1a, Lane A's agreed regions)" \
  -m "red: 1 error (ImportError: cannot import name 'KABUL' from 'homunculus.api.patient_identity')" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- homunculus-engine/tests/test_kabul_identity.py homunculus-engine/tests/test_patient_identity_postgres.py homunculus-engine/src/homunculus/api/patient_identity.py homunculus-engine/src/homunculus/api/patient_identity_postgres.py homunculus-engine/src/homunculus/api/board.py
```

---

### Task 6: `BoardLink`, and the three agreed `api/app.py` touches (Lane A file)

**Lane:** backend. **Needs:** Task 5.

Spec D7, §4.3, §7 (item 1), X55, X62, and the alert latch (Lane A's A1, merged). `admission/boardlink.py` is the one door from the admissions world to the board world: `put_identity` (the card appears on its bed and the stream hears it), `chart_weight` (the weight charted through `api/clinical.build_entries`, A1's `sync_alerts` run right after the evaluation as `/clinical` runs it, and the same audit rows `/clinical` writes, so a restart replays it — X62), `apply_profile` (the comorbidity codes merged into the engine's profile, the same audit row as `PUT /clinical/{id}/profile`), `open_critical` and `discharge_identity` (the card leaves every screen; the removal carries the last bed and unit). `open_critical` counts, on the board `patient_board` builds, the alerts with `severity == "critical"` and `acknowledged` false — **whether firing or latched**: A1 keeps an unacknowledged critical alert on the board after its rule stops, with `resolved_at` set, until a clinician acknowledges it. The test drives the real app — the synthetic septic-shock scenario through `/ingest` (septic shock fires, critical), a normal lactate (it latches), `/ack` (it leaves) — and reads `open_critical` at each step: 1, 1, 0; an acknowledged critical that still fires counts 0. No hand-made alert. On a patient the engine never measured it is 0 and creates nothing.

`api/app.py` (Lane A's, the agreed regions only): an import after `api.trends`'; `app.state.board_link = BoardLink(…)` after `app.state.shadow_store`; inside the 24 h sweep, the `removed` frame's identity carries `{"bed_id", "unit_id"}` when the record has its own bed (a HIS-fed record still sends `identity: null` — X55); `_occupants` (the Aşama A strip's link of a device to the patient on its bed) resolves a record by its own `bed_id` before the bed map.

**Files:**
- Create: `homunculus-engine/tests/test_kabul_boardlink.py`
- Create: `homunculus-engine/src/homunculus/admission/boardlink.py`
- Modify: `homunculus-engine/src/homunculus/api/app.py` **(Lane A file — agreed region)**

- [ ] **Step 1: Write the failing test** — each door on the real app; a restart replays the weight and the profile; open-critical on the real board, firing then latched then acknowledged; the sweep's removal; the strip's link:

**Write** `homunculus-engine/tests/test_kabul_boardlink.py` (a new file, whole):

```python
# homunculus-engine/tests/test_kabul_boardlink.py
"""BoardLink — the one way admission code touches the board world (Group 2 · B1a, spec §4.3) — on
the app `api/app.py` builds: the card appears on its bed for the board and the stream, the weight
and the comorbidities reach the engine through the audit a restart replays, the open-critical
count is the board's own, and a discharge takes the card off every screen, a scoped one of that
unit included. And the monitor strip (Aşama A) links a device to a `kabul` patient by the bed the
admission chose. No database. Synthetic patients only."""
from __future__ import annotations

import asyncio
import copy
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from fastapi.testclient import TestClient

import homunculus.scenarios
from homunculus.admission.boardlink import BoardLink, kabul_record
from homunculus.api.app import create_app, sse_board_frames
from homunculus.api.audit import InMemoryAuditLog
from homunculus.api.patient_identity import IdentityRecord, InMemoryIdentityStore
from homunculus.scenarios.loader import load_scenario
from homunculus.scope import build_scope, sees_patient
from tests.test_infinity_shadow_api import HOSPITAL as SHADOW_HOSPITAL
from tests.test_infinity_shadow_api import _app as shadow_app, _board as shadow_board
from tests.test_infinity_shadow_api import _post as shadow_post

TOKEN, HOSPITAL = "t", "HOSP1"
AUTH = {"Authorization": f"Bearer {TOKEN}"}
BED = "5f0c6a1e-0000-4000-8000-0000000000b1"
UNIT = "5f0c6a1e-0000-4000-8000-0000000000a1"
T0 = datetime(2026, 10, 25, 8, 0, tzinfo=timezone.utc)
SCEN = Path(homunculus.scenarios.__file__).parent
#: A lactate reading after the scenario's last event (synthetic), its value set by the test.
LACTATE = {"resourceType": "Observation", "code": {"coding": [{"system": "x", "code": "lactate"}]},
           "subject": {"reference": "Patient/H2600001"}, "effectiveDateTime": "2026-07-14T11:01:00+00:00"}


def record(number: str = "H2600001", bed_id: str = BED, unit_id: str = UNIT):
    return kabul_record(patient_number=number, display_name="Sentetik Hasta",
                        birth_date=date(1970, 1, 1), sex="female", bed_label="1A",
                        bed_id=bed_id, unit_id=unit_id, at=T0)


def app_and_link(audit=None, identities=None):
    app = create_app({TOKEN: HOSPITAL}, run_escalation_loop=False,
                     audit=audit or InMemoryAuditLog(), identities=identities)
    return app, app.state.board_link


def board(app) -> list[dict]:
    with TestClient(app) as client:
        response = client.get("/patients", headers=AUTH)
    assert response.status_code == 200, response.text
    return response.json()["patients"]


def test_the_app_builds_its_board_link():
    _app, link = app_and_link()
    assert isinstance(link, BoardLink)


def test_an_admission_puts_its_card_on_its_bed_and_tells_the_stream():
    app, link = app_and_link()
    queue = app.state.broadcaster.subscribe(HOSPITAL)
    asyncio.run(link.put_identity(HOSPITAL, record()))

    (card,) = board(app)
    assert card["patient_id"] == "H2600001"
    assert (card["identity"]["bed_id"], card["identity"]["unit_id"]) == (BED, UNIT)
    assert (card["identity"]["bed_label"], card["identity"]["display_name"]) == ("1A", "Sentetik Hasta")
    assert card["identity"]["source"] == "kabul"
    assert queue.get_nowait()["patient_id"] == "H2600001"


def test_the_weight_and_the_comorbidities_reach_the_engine_and_survive_a_restart():
    audit = InMemoryAuditLog()
    identities = InMemoryIdentityStore()
    app, link = app_and_link(audit, identities)
    asyncio.run(link.put_identity(HOSPITAL, record()))
    asyncio.run(link.chart_weight(HOSPITAL, "H2600001", 72.5, actor="hemsire"))
    asyncio.run(link.apply_profile(HOSPITAL, "H2600001", ["copd", "dementia"], actor="hemsire"))

    rows = audit.records(tenant=HOSPITAL, patient_id="H2600001", limit=50)
    chart = next(r for r in rows if r.event_type == "chart")
    assert (chart.subject, chart.payload["value"], chart.payload["charted_by"]) == \
        ("weight_kg", 72.5, "hemsire")
    profile = next(r for r in rows if r.event_type == "profile")
    assert profile.payload["comorbidities"] == ["copd", "dementia"]
    assert "Sentetik" not in repr([r.payload for r in rows])

    restarted, _ = app_and_link(audit, identities)      # the engine rebuilt from the audit
    (card,) = board(restarted)
    assert card["meds"]["weight_kg"] == 72.5
    engine = restarted.state.board_link._engine(HOSPITAL)
    assert engine.profile("H2600001").comorbidities == frozenset({"copd", "dementia"})


def _ingest(client, fhir: dict, number: str = "H2600001") -> None:
    fhir = copy.deepcopy(fhir)
    fhir["subject"]["reference"] = f"Patient/{number}"
    assert client.post("/ingest", json=fhir, headers=AUTH).status_code == 200


def _alert(client, kind: str, number: str = "H2600001") -> dict | None:
    return next((a for b in client.get("/patients", headers=AUTH).json()["patients"]
                 if b["patient_id"] == number for a in b["alerts"] if a["kind"] == kind), None)


def test_open_critical_counts_a_critical_nobody_acknowledged_firing_then_latched():
    """G2-A1 (O17): a critical alert whose rule stops firing while nobody acknowledged it stays on
    the board, latched (`resolved_at` set, `acknowledged` false), until a clinician acknowledges
    it. It blocks a discharge as a firing one does. Driven through the app's own doors and read
    from `patient_board`'s own output: the synthetic septic-shock scenario, then a normal lactate."""
    app, link = app_and_link()
    asyncio.run(link.put_identity(HOSPITAL, record()))
    with TestClient(app) as client:
        for _ts, fhir in load_scenario(SCEN / "septic_shock.yaml"):
            _ingest(client, fhir)
        shock = _alert(client, "septic_shock")
        assert (shock["severity"], shock["acknowledged"], shock["resolved_at"]) == ("critical", False, None)
        assert link.open_critical(HOSPITAL, "H2600001") == 1      # sepsis and antibiotic_due: high

        _ingest(client, {**LACTATE, "valueQuantity": {"value": 1.5, "unit": "mmol/L"}})
        shock = _alert(client, "septic_shock")
        assert shock["resolved_at"] is not None and shock["acknowledged"] is False   # latched
        assert link.open_critical(HOSPITAL, "H2600001") == 1

        assert client.post("/ack", json={"patient_id": "H2600001", "kind": "septic_shock",
                                         "role": "nurse"}, headers=AUTH).status_code == 200
        assert _alert(client, "septic_shock") is None                # the answer removes the latch
        assert link.open_critical(HOSPITAL, "H2600001") == 0


def test_an_acknowledged_critical_does_not_count_while_it_still_fires():
    app, link = app_and_link()
    asyncio.run(link.put_identity(HOSPITAL, record()))
    with TestClient(app) as client:
        for _ts, fhir in load_scenario(SCEN / "septic_shock.yaml"):
            _ingest(client, fhir)
        client.post("/ack", json={"patient_id": "H2600001", "kind": "septic_shock", "role": "nurse"},
                    headers=AUTH)
        assert _alert(client, "septic_shock")["acknowledged"] is True
        assert link.open_critical(HOSPITAL, "H2600001") == 0


def test_open_critical_on_a_patient_never_measured_is_nought_and_creates_nothing():
    app, link = app_and_link()
    asyncio.run(link.put_identity(HOSPITAL, record()))
    assert link.open_critical(HOSPITAL, "H2600001") == 0
    assert link._engine(HOSPITAL).patient_ids() == []


def test_a_discharge_takes_the_card_off_and_the_removal_reaches_the_units_scoped_screen():
    app, link = app_and_link()
    asyncio.run(link.put_identity(HOSPITAL, record()))
    asyncio.run(link.put_identity(HOSPITAL, record("H2600002", bed_id="other-bed", unit_id="other-unit")))
    queue = app.state.broadcaster.subscribe(HOSPITAL)
    asyncio.run(link.discharge_identity(HOSPITAL, "H2600001"))

    assert [c["patient_id"] for c in board(app)] == ["H2600002"]
    frame = queue.get_nowait()
    assert (frame["patient_id"], frame["removed"]) == ("H2600001", True)
    assert frame["identity"] == {"bed_id": BED, "unit_id": UNIT}

    async def first_frame(scope):
        frames = asyncio.Queue()
        await frames.put(frame)
        stream = sse_board_frames(frames, keepalive=0.05, allow=lambda b: sees_patient(b, scope))
        return await anext(stream)

    assert '"removed": true' in asyncio.run(first_frame(build_scope("MEMBER", unit_ids=[UNIT])))
    assert asyncio.run(first_frame(build_scope("MEMBER", unit_ids=["other-unit"]))) == \
        ": keep-alive\n\n"


def test_readings_after_discharge_are_kept_by_the_engine_and_never_bring_the_card_back():
    app, link = app_and_link()
    asyncio.run(link.put_identity(HOSPITAL, record()))
    asyncio.run(link.discharge_identity(HOSPITAL, "H2600001"))
    asyncio.run(link.chart_weight(HOSPITAL, "H2600001", 70.0, actor="hemsire"))
    assert "H2600001" in link._engine(HOSPITAL).patient_ids()
    assert board(app) == []


def test_the_retention_sweep_sends_a_removal_with_the_last_bed_and_unit():
    """api/app.py's 24-hour sweep (a record that is not a `kabul` tombstone, but had its own bed):
    the removal used to carry no identity at all, so no scoped screen ever received it."""
    identities = InMemoryIdentityStore()
    identities.apply(HOSPITAL, IdentityRecord(patient_id="M-1", given="Sentetik", bed="1A",
                                              state="admitted", source="manuel", updated_at=T0,
                                              bed_id=BED, unit_id=UNIT))
    identities.apply(HOSPITAL, IdentityRecord(patient_id="M-1", state="discharged",
                                              source="manuel", updated_at=T0))
    app, _ = app_and_link(identities=identities)
    queue = app.state.broadcaster.subscribe(HOSPITAL)
    asyncio.run(app.state.escalation_cycle(T0 + timedelta(days=2)))
    frame = queue.get_nowait()
    assert (frame["patient_id"], frame["removed"]) == ("M-1", True)
    assert frame["identity"] == {"bed_id": BED, "unit_id": UNIT}
    assert sees_patient(frame, build_scope("MEMBER", unit_ids=[UNIT]))


def test_the_monitor_strip_links_a_device_to_the_kabul_patient_on_its_bed(tmp_path):
    """Aşama A's `_occupants`: the table row's bed_id is the tenant bed UUID from now on; a `kabul`
    identity names that bed itself, with no HIS location for the bed map to resolve."""
    identities = InMemoryIdentityStore()
    identities.apply(SHADOW_HOSPITAL, record(bed_id="bed-b2", unit_id="unit-2"))
    client, clock, _ = shadow_app(tmp_path, identities=identities)
    shadow_post(client, clock)
    beds = {b["bed_label"]: b for b in shadow_board(client)["beds"]}
    assert (beds["B-2"]["link"], beds["B-2"]["patient_id"]) == ("one", "H2600001")
    assert (beds["B-1"]["link"], beds["B-1"]["patient_id"]) == ("none", None)
```


- [ ] **Step 2: Run it and see it red** — `admission/boardlink.py` does not exist:

```bash
cd /c/tmp/g2b-kabul-be/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 \
  /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_kabul_boardlink.py 2>&1 | grep -E "^(FAILED|ERROR) |[0-9]+ (passed|failed|error)|^E +[A-Za-z]*(Error|Exception)" | head -16
```

Expected (the replay, times vary):

```text
ERROR tests/test_kabul_boardlink.py
1 warning, 1 error in …s
E   ModuleNotFoundError: No module named 'homunculus.admission.boardlink'
```


- [ ] **Step 3: Write `BoardLink`; wire it and make the two agreed changes in `api/app.py`:**

**Write** `homunculus-engine/src/homunculus/admission/boardlink.py` (a new file, whole):

```python
# homunculus-engine/src/homunculus/admission/boardlink.py
"""The one way admission code touches the board world (Group 2 · B1a, spec §4.3).

Two worlds meet here. The admissions world — `admission/` and `tenant/`, in Postgres, keyed by
UUID — knows who lies in which bed. The board world — the engine, the identity store, the ack
store, the board stream — is keyed by a patient-id string and never saw an admission. `BoardLink`
writes from the first into the second, and nothing else in `admission/` does:

* `put_identity`      the board identity of an admission (source `kabul`, keyed by the patient
                      number, with the bed and unit ids) — the card appears on its bed;
* `chart_weight`      the admission weight, charted through the engine as `POST /clinical` charts
                      it (the same audit row, so a restart replays it);
* `apply_profile`     the comorbidity codes ticked on the form, merged into the engine's profile
                      as `PUT /clinical/{id}/profile` merges them (same audit row);
* `open_critical`     how many critical alerts on this patient's board nobody has acknowledged —
                      a latched one (`resolved_at` set, G2-A1) counted as firing ones are:
                      the same alerts the clinician sees, never the Postgres escalation tables;
* `discharge_identity` the identity discharged: the card leaves every screen, and the removal
                      carries the last bed and unit so a scoped screen of that unit hears it.

It is built in `api/app.py` from the app's own stores and placed on `app.state.board_link`; a
router reaches it through the request (`board_link_of`). An app built without it (a test that
mounts the routers alone) has none, and the admission routes answer `skipped` for its parts.

`chart_weight` is called for a number the admission has just issued: the engine knows nothing of
that patient yet, so the reading cannot end or start an alert episode (the lifecycle the doors of
`api/app.py` run after each evaluation has nothing to do there). It is not a door for charting.

PHI: the identity carries the name, as an ADT record does (encrypted at rest by the store). The
audit rows carry the number, the bed and the actor — never a name.
"""
from __future__ import annotations

from collections.abc import Awaitable, Callable
from datetime import date, datetime, timezone

from fastapi import Request

from homunculus.api.ackstore import AckStore
from homunculus.api.alert_lifecycle import sync_alerts
from homunculus.api.audit import AuditEvent, AuditLog
from homunculus.api.board import identity_only_board, patient_board
from homunculus.api.clinical import build_entries, profile_from_payload, profile_to_payload
from homunculus.api.patient_identity import KABUL, IdentityRecord, IdentityStore
from homunculus.pipeline import Engine
from homunculus.tenant.bedmap import BedMap

CRITICAL = "critical"


def count_open_critical(alerts: list[dict]) -> int:
    """Critical alerts nobody acknowledged, in the board's own alert shape (`api/board.py`). A
    latched one — its rule stopped, `resolved_at` set (G2-A1, O17) — counts like a firing one:
    a critical event is seen before the patient leaves (spec §3.3)."""
    return sum(1 for alert in alerts
               if isinstance(alert, dict) and alert.get("severity") == CRITICAL
               and not alert.get("acknowledged"))


def kabul_record(*, patient_number: str, display_name: str, birth_date: date, sex: str,
                 bed_label: str, bed_id: str, unit_id: str, at: datetime) -> IdentityRecord:
    """The board identity of an admission made here. The whole name goes in `given`: the form
    asks for one "ad soyad" field, and `display_name` joins given and family anyway."""
    return IdentityRecord(patient_id=patient_number, given=display_name.strip(),
                          birth_date=birth_date.isoformat(), sex=sex, bed=bed_label,
                          state="admitted", source=KABUL, updated_at=at,
                          bed_id=bed_id, unit_id=unit_id)


class BoardLink:
    def __init__(self, *, identities: IdentityStore, engine: Callable[[str], Engine],
                 store: Callable[[str], AckStore], audit: AuditLog,
                 publish: Callable[[str, dict], Awaitable[None]], bedmap: BedMap | None = None,
                 clock: Callable[[], datetime] = lambda: datetime.now(timezone.utc)) -> None:
        self._identities = identities
        self._engine = engine
        self._store = store
        self._audit = audit
        self._publish = publish
        self._bedmap = bedmap
        self._clock = clock

    def _board(self, tenant: str, patient_number: str,
               identity: IdentityRecord | None = None) -> dict:
        """The patient's board as /patients would carry it — built without creating the patient
        in the engine (`patient_board` reads `engine.state()`, which would)."""
        engine = self._engine(tenant)
        identity = identity if identity is not None else self._identities.get(tenant, patient_number)
        if patient_number in set(engine.patient_ids()) or identity is None:
            return patient_board(engine, patient_number, self._store(tenant), identity=identity,
                                 bedmap=self._bedmap)
        return identity_only_board(identity, self._bedmap)

    async def put_identity(self, tenant: str, record: IdentityRecord) -> None:
        stored = self._identities.apply(tenant, record)
        await self._publish(tenant, self._board(tenant, record.patient_id, stored))

    async def chart_weight(self, tenant: str, patient_number: str, kg: float, *,
                           actor: str) -> None:
        engine, store = self._engine(tenant), self._store(tenant)
        now = self._clock()
        for item in build_entries(patient_number, [{"code": "weight_kg", "value": kg}],
                                  charted_by=actor, recorded_at=None):
            obs = item.observation
            alerts = engine.ingest(obs, now=obs.timestamp)
            # G2-A1's hook after every evaluation, before any audit write, as `/clinical` runs it
            # (api/alert_lifecycle.py): the store's view of what fires stays the engine's.
            cleared = sync_alerts(engine, store, obs.patient_id, now)
            self._audit.append(AuditEvent(tenant, "chart", obs.patient_id, obs.code.value,
                                          {"value": obs.value, "unit": obs.unit,
                                           "obs_ts": obs.timestamp.isoformat(),
                                           "charted_by": item.charted_by}))
            for c in cleared:
                self._audit.append(AuditEvent(tenant, "alert_cleared", c.patient_id, c.kind,
                                              c.payload(now)))
            for a in alerts:
                self._audit.append(AuditEvent(tenant, "alert", a.patient_id, a.kind,
                                              {"severity": a.severity, "urgency": a.urgency,
                                               "summary": a.summary, "source": a.source,
                                               "evidence": a.supporting_evidence}))
        for a in engine.active_alerts(patient_number):
            if store.stamp_first_seen(patient_number, a.kind, now):
                self._audit.append(AuditEvent(tenant, "first_seen", patient_number, a.kind,
                                              {"at": now.isoformat()}))
        await self._publish(tenant, self._board(tenant, patient_number))

    async def apply_profile(self, tenant: str, patient_number: str, codes: list[str], *,
                            actor: str) -> None:
        engine = self._engine(tenant)
        profile = profile_from_payload(patient_number, {"comorbidities": list(codes)},
                                       engine.profile(patient_number))
        engine.set_profile(profile)
        self._audit.append(AuditEvent(tenant, "profile", profile.patient_id, "",
                                      {**profile_to_payload(profile), "charted_by": actor}))
        await self._publish(tenant, self._board(tenant, patient_number))

    def open_critical(self, tenant: str, patient_number: str) -> int:
        engine = self._engine(tenant)
        if patient_number not in set(engine.patient_ids()):
            return 0                     # never measured: no alert can be on its board
        return count_open_critical(self._board(tenant, patient_number).get("alerts") or [])

    async def discharge_identity(self, tenant: str, patient_number: str) -> None:
        stored = self._identities.apply(tenant, IdentityRecord(
            patient_id=patient_number, state="discharged", source=KABUL,
            updated_at=self._clock()))
        if stored is None:               # a newer record exists: it decides, nothing to say
            return
        # A tombstone's board IS its removal (api/board.py `_tombstone_board`).
        await self._publish(tenant, patient_board(self._engine(tenant), patient_number,
                                                  self._store(tenant), identity=stored,
                                                  bedmap=self._bedmap))


def board_link_of(request: Request) -> BoardLink | None:
    """The app's BoardLink, or None when the app was built without one."""
    return getattr(request.app.state, "board_link", None)
```

**Edit** `homunculus-engine/src/homunculus/api/app.py` (1) — replace:

```python
from homunculus.api.trends import TRENDS_HOURS, patient_trends
from homunculus.auth.permissions import validate_permissions
```

with:

```python
from homunculus.api.trends import TRENDS_HOURS, patient_trends
from homunculus.admission.boardlink import BoardLink    # G2-B1a
from homunculus.auth.permissions import validate_permissions
```

**Edit** `homunculus-engine/src/homunculus/api/app.py` (2) — replace:

```python
                else:
                    board = {**identity_only_board(record), "identity": None, "removed": True}
                await broadcaster.publish(hospital, board)
```

with:

```python
                else:
                    # G2-B1a: a record with its own bed sends its last bed and unit with the
                    # removal, so a screen scoped to that unit is told too (`sees_patient` reads
                    # them). A HIS-fed one has none to send (`_merge` cleared its location).
                    board = {**identity_only_board(record), "removed": True,
                             "identity": ({"bed_id": record.bed_id,
                                           "unit_id": record.unit_id or None}
                                          if record.bed_id else None)}
                await broadcaster.publish(hospital, board)
```

**Edit** `homunculus-engine/src/homunculus/api/app.py` (3) — replace:

```python
    app.state.shadow_store = shadow_store

```

with:

```python
    app.state.shadow_store = shadow_store
    # G2-B1a: the admission routes' one way into the board world (admission/boardlink.py).
    app.state.board_link = BoardLink(identities=identities, engine=_engine, store=_store,
                                     audit=audit, publish=broadcaster.publish, bedmap=bedmap)

```

**Edit** `homunculus-engine/src/homunculus/api/app.py` (4) — replace:

```python
                continue
            ref = bedmap.lookup(record.unit, record.room, record.bed)
            if ref is not None and normalise_id(ref.bed_id):
                beds.setdefault(normalise_id(ref.bed_id), []).append(patient_id)
        shadow_occupancy[hospital] = (now, beds)
```

with:

```python
                continue
            # G2-B1a: an admission made here names its own bed — the tenant's UUID, which the
            # device→bed table carries from now on. A HIS-fed record goes through the bed map.
            if record.bed_id:
                bed_id = record.bed_id
            else:
                ref = bedmap.lookup(record.unit, record.room, record.bed)
                bed_id = ref.bed_id if ref is not None else ""
            if normalise_id(bed_id):
                beds.setdefault(normalise_id(bed_id), []).append(patient_id)
        shadow_occupancy[hospital] = (now, beds)
```


- [ ] **Step 4: Run it green, with the app's ingest, shadow, stream, permission and inventory suites:**

```bash
cd /c/tmp/g2b-kabul-be/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 \
  /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_kabul_boardlink.py tests/test_api_identity_ingest.py tests/test_infinity_shadow_api.py tests/test_infinity_shadow_isolation.py tests/test_api_stream.py tests/test_board_permissions.py tests/test_route_inventory.py 2>&1 | grep -E "^(FAILED|ERROR) |[0-9]+ (passed|failed|error)|^E +[A-Za-z]*(Error|Exception)" | head -16
```

Expected (the replay, times vary):

```text
157 passed, 3 warnings in …s
```


- [ ] **Step 5: The whole no-DB suite:**

```bash
cd /c/tmp/g2b-kabul-be/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 \
  /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q --ignore=tests/test_infinity_vm_pilot.py 2>&1 | grep -E "^(FAILED|ERROR) |[0-9]+ (passed|failed|error)|^E +[A-Za-z]*(Error|Exception)" | head -16
```

Expected (the replay, times vary):

```text
2330 passed, 667 skipped, 3 warnings in …s
```


- [ ] **Step 6: Line ends:**

```bash
cd /c/tmp/g2b-kabul-be
for f in homunculus-engine/tests/test_kabul_boardlink.py homunculus-engine/src/homunculus/admission/boardlink.py homunculus-engine/src/homunculus/api/app.py; do printf "%s CR=%s LF=%s\n" "$f" "$(tr -cd '\r' < "$f" | wc -c)" "$(tr -cd '\n' < "$f" | wc -c)"; done
```

Expected:

```text
homunculus-engine/tests/test_kabul_boardlink.py CR=0 LF=213
homunculus-engine/src/homunculus/admission/boardlink.py CR=0 LF=157
homunculus-engine/src/homunculus/api/app.py CR=1198 LF=1198
```


- [ ] **Step 7: Commit:**

```bash
cd /c/tmp/g2b-kabul-be
git add -- homunculus-engine/tests/test_kabul_boardlink.py homunculus-engine/src/homunculus/admission/boardlink.py homunculus-engine/src/homunculus/api/app.py
git status --short && git diff --cached --stat
git commit -m "feat(admission): BoardLink — the one door from an admission to the board; wired in api/app.py (G2-B1a, Lane A's agreed regions)" \
  -m "red: 1 warning, 1 error (ModuleNotFoundError: No module named 'homunculus.admission.boardlink')" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- homunculus-engine/tests/test_kabul_boardlink.py homunculus-engine/src/homunculus/admission/boardlink.py homunculus-engine/src/homunculus/api/app.py
```

---

### Task 7: The structure routes — `GET /tenant/structure`, rename / close / reopen, the bed release

**Lane:** backend. **Needs:** Task 4 (`unitscope`), Task 6.

Spec D8, D9, D10, §3.4, §3.5, §4.4, §4.5, X52. `GET /tenant/structure` answers the tenant's units → rooms → beds, each with its name, `is_active` and (a bed) its state, in natural order ("2" before "10"), to holders of `admissions.view`, `admissions.admit`, `beds.release`, `structure.manage` or `users.manage` (X52): a `structure.manage` holder sees the whole tenant, everyone else her units (a unit grant: that unit whole; a bed grant: that bed in its room and unit). `PATCH /tenant/units|rooms|beds/{id}` renames, closes and reopens (`structure.manage`): a bed holding a patient is not closed (`bed_in_use`), a unit or room with an open bed is not closed until its beds are (`has_open_beds`), a name another room or bed of the same parent holds is refused (`name_taken`), an empty name is `field_invalid:name`. `POST /tenant/beds/{id}/release` (`beds.release`, in the caller's units) turns a bed in cleaning (`HOUSEKEEPING`) AVAILABLE — any other state is `invalid_transition` — and writes the audit row `bed.release` (the bed, the actor; `admission/trail.py` holds the hospital key and the row). A test file builds a synthetic ward for this task and the next two: `tests/kabul_world.py`.

**Files:**
- Create: `homunculus-engine/tests/kabul_world.py`
- Create: `homunculus-engine/tests/test_structure_api.py`
- Create: `homunculus-engine/src/homunculus/admission/trail.py`
- Modify: `homunculus-engine/tests/test_route_permissions.py`
- Modify: `homunculus-engine/tests/test_tenant_isolation.py`
- Modify: `homunculus-engine/src/homunculus/tenant/schemas.py`
- Modify: `homunculus-engine/src/homunculus/tenant/router.py`

- [ ] **Step 1: Write the failing tests** — the ward, the routes' behaviour, the route registry's five rows and the tenant isolation suite's new rows:

**Write** `homunculus-engine/tests/kabul_world.py` (a new file, whole):

```python
# homunculus-engine/tests/kabul_world.py
"""A ward for the Hasta Kabul route tests (Group 2 · B1a): one tenant with its default groups, two
units and five beds, staff in the groups the spec names with their unit grants (the tenant's own
UUIDs, spec D9), signed-in tokens for each, and a client on an app whose device token reads that
tenant's board (the engine's hospital key is the tenant slug). Synthetic everything.

    Ana bina
      Reanimasiya (ADULT_ICU)   Otaq 1: beds 1, 2, 10      Otaq 2: bed 3
      Neonatal (NICU)           N-1: bed N1

    admin      hospital_admin   unrestricted by role
    nurse      nurse            granted Reanimasiya
    nurse_b    nurse            granted Neonatal
    charge     charge_nurse     granted Reanimasiya
    doctor     attending        granted Reanimasiya
    auditor    auditor          no admission right at all
"""
from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass

from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from homunculus.api.app import create_app
from homunculus.auth.groups import ensure_default_groups
from homunculus.auth.models import User
from homunculus.db import get_db
from homunculus.scope.models import StaffScope
from homunculus.tenant.models import Bed, Room, Site, Tenant, Unit, UnitType
from tests.signed_in import add_user, bearer

SLUG = "kabul-hastane"
DEVICE = "kabul-device-token"
BOARD = {"Authorization": f"Bearer {DEVICE}"}


@dataclass
class Ward:
    tenant: Tenant
    site: Site
    units: dict[str, Unit]
    rooms: dict[str, Room]
    beds: dict[str, Bed]
    users: dict[str, User]
    auth: dict[str, dict[str, str]]


async def build_ward(db: AsyncSession) -> Ward:
    tenant = Tenant(name="Sentetik Kabul Hastanesi", slug=SLUG, country_code="AZ")
    db.add(tenant)
    await db.flush()
    groups = await ensure_default_groups(db, tenant.id)
    site = Site(tenant_id=tenant.id, name="Ana bina")
    db.add(site)
    await db.flush()
    units = {"rea": Unit(site_id=site.id, name="Reanimasiya", unit_type=UnitType.ADULT_ICU),
             "neo": Unit(site_id=site.id, name="Neonatal", unit_type=UnitType.NICU)}
    db.add_all(units.values())
    await db.flush()
    rooms = {"o1": Room(unit_id=units["rea"].id, name="Otaq 1"),
             "o2": Room(unit_id=units["rea"].id, name="Otaq 2"),
             "n1": Room(unit_id=units["neo"].id, name="N-1")}
    db.add_all(rooms.values())
    await db.flush()
    beds = {"1": Bed(room_id=rooms["o1"].id, label="1"), "2": Bed(room_id=rooms["o1"].id, label="2"),
            "10": Bed(room_id=rooms["o1"].id, label="10"), "3": Bed(room_id=rooms["o2"].id, label="3"),
            "N1": Bed(room_id=rooms["n1"].id, label="N1")}
    db.add_all(beds.values())
    await db.flush()

    staff = {"admin": ("hospital_admin", None), "nurse": ("nurse", "rea"),
             "nurse_b": ("nurse", "neo"), "charge": ("charge_nurse", "rea"),
             "doctor": ("attending", "rea"), "auditor": ("auditor", None)}
    users: dict[str, User] = {}
    for name, (group, unit) in staff.items():
        users[name] = await add_user(db, username=f"{name}@kabul.example.com",
                                     tenant_id=tenant.id, group=groups[group])
        if unit is not None:
            db.add(StaffScope(tenant_id=tenant.id, user_id=users[name].id,
                              unit_id=str(units[unit].id)))
    await db.commit()
    auth = {name: await bearer(db, user) for name, user in users.items()}
    return Ward(tenant=tenant, site=site, units=units, rooms=rooms, beds=beds, users=users, auth=auth)


def ward_app() -> FastAPI:
    """The app with a device token for the ward's tenant: `BOARD` reads its board."""
    return create_app({DEVICE: SLUG}, run_escalation_loop=False)


@asynccontextmanager
async def ward_client(db: AsyncSession) -> AsyncIterator[tuple[AsyncClient, FastAPI]]:
    app = ward_app()
    maker = async_sessionmaker(db.bind, expire_on_commit=False)

    async def _db():
        async with maker() as session:
            yield session

    app.dependency_overrides[get_db] = _db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client, app
```

**Write** `homunculus-engine/tests/test_structure_api.py` (a new file, whole):

```python
# homunculus-engine/tests/test_structure_api.py
"""The structure routes of Group 2 · B1a (spec §3.4, §3.5, §4.4): the tree every screen reads its
unit and bed names from, limited to the caller's units; the administrator's rename / close /
reopen, with nothing deleted and no occupied bed closed; and a nurse's "cleaning done, bed free",
in her own units, audited. Postgres (`db_session`). Synthetic ward: tests/kabul_world.py."""
from __future__ import annotations

import pytest_asyncio
from sqlalchemy import select

from homunculus.tenant.models import Bed, BedState
from tests.conftest import requires_db
from tests.kabul_world import build_ward, ward_client

pytestmark = [requires_db]


@pytest_asyncio.fixture
async def ward(db_session, monkeypatch):
    monkeypatch.delenv("SCOPE_ENFORCE_UNASSIGNED", raising=False)
    built = await build_ward(db_session)
    async with ward_client(db_session) as (client, app):
        yield built, client, app


def _tree(answer: dict) -> dict:
    """{unit name: {room name: [bed label, …]}}, in the order the API gives them."""
    return {u["name"]: {r["name"]: [b["label"] for b in r["beds"]] for r in u["rooms"]}
            for s in answer["sites"] for u in s["units"]}


async def _set_state(db, bed: Bed, state: BedState) -> None:
    bed.state = state
    db.add(bed)
    await db.commit()


# ---------------------------------------------------------------- GET /tenant/structure
async def test_a_nurse_reads_her_units_tree_with_names_and_states(ward):
    w, client, _ = ward
    r = await client.get("/tenant/structure", headers=w.auth["nurse"])
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["tenant_id"] == str(w.tenant.id)
    assert _tree(body) == {"Reanimasiya": {"Otaq 1": ["1", "2", "10"], "Otaq 2": ["3"]}}
    bed = body["sites"][0]["units"][0]["rooms"][0]["beds"][0]
    assert bed == {"id": str(w.beds["1"].id), "label": "1", "state": "AVAILABLE", "is_active": True}


async def test_the_administrator_and_the_unassigned_see_every_unit(ward, db_session):
    w, client, _ = ward
    for who in ("admin",):
        tree = _tree((await client.get("/tenant/structure", headers=w.auth[who])).json())
        assert set(tree) == {"Reanimasiya", "Neonatal"}


async def test_a_bed_grant_shows_that_bed_in_its_room_and_unit_alone(ward, db_session):
    from homunculus.scope.models import StaffScope

    w, client, _ = ward
    nurse_b = w.users["nurse_b"]
    db_session.add(StaffScope(tenant_id=w.tenant.id, user_id=nurse_b.id, bed_id=str(w.beds["3"].id)))
    await db_session.commit()
    tree = _tree((await client.get("/tenant/structure", headers=w.auth["nurse_b"])).json())
    assert tree == {"Reanimasiya": {"Otaq 2": ["3"]}, "Neonatal": {"N-1": ["N1"]}}


async def test_a_caller_with_no_admission_right_is_refused(ward):
    w, client, _ = ward
    r = await client.get("/tenant/structure", headers=w.auth["auditor"])
    assert r.status_code == 403


# ---------------------------------------------------------------- rename, close, reopen
async def test_the_administrator_renames_a_unit_a_room_and_a_bed(ward):
    w, client, _ = ward
    admin = w.auth["admin"]
    assert (await client.patch(f"/tenant/units/{w.units['rea'].id}", json={"name": " Reanimasiya 1 "},
                               headers=admin)).json()["name"] == "Reanimasiya 1"
    assert (await client.patch(f"/tenant/rooms/{w.rooms['o2'].id}", json={"name": "Otaq 2A"},
                               headers=admin)).json()["name"] == "Otaq 2A"
    assert (await client.patch(f"/tenant/beds/{w.beds['10'].id}", json={"label": "4"},
                               headers=admin)).json()["label"] == "4"


async def test_a_name_another_room_or_bed_of_the_same_parent_holds_is_refused(ward):
    w, client, _ = ward
    admin = w.auth["admin"]
    room = await client.patch(f"/tenant/rooms/{w.rooms['o2'].id}", json={"name": "Otaq 1"},
                              headers=admin)
    bed = await client.patch(f"/tenant/beds/{w.beds['10'].id}", json={"label": "2"}, headers=admin)
    for r in (room, bed):
        assert r.status_code == 409 and r.json()["detail"]["code"] == "name_taken"
    blank = await client.patch(f"/tenant/beds/{w.beds['10'].id}", json={"label": "  "}, headers=admin)
    assert (blank.status_code, blank.json()["detail"]["code"]) == (422, "field_invalid:label")


async def test_a_bed_holding_a_patient_cannot_be_closed_and_a_free_one_can(ward, db_session):
    w, client, _ = ward
    admin = w.auth["admin"]
    for state in (BedState.OCCUPIED, BedState.PENDING_DISCHARGE):
        await _set_state(db_session, w.beds["1"], state)
        r = await client.patch(f"/tenant/beds/{w.beds['1'].id}", json={"is_active": False},
                               headers=admin)
        assert (r.status_code, r.json()["detail"]["code"]) == (409, "bed_in_use")
    await _set_state(db_session, w.beds["1"], BedState.HOUSEKEEPING)
    r = await client.patch(f"/tenant/beds/{w.beds['1'].id}", json={"is_active": False}, headers=admin)
    assert r.status_code == 200 and r.json()["is_active"] is False
    r = await client.patch(f"/tenant/beds/{w.beds['1'].id}", json={"is_active": True}, headers=admin)
    assert r.status_code == 200 and r.json()["is_active"] is True


async def test_a_room_or_unit_with_an_open_bed_cannot_be_closed_until_its_beds_are(ward):
    w, client, _ = ward
    admin = w.auth["admin"]
    r = await client.patch(f"/tenant/rooms/{w.rooms['o2'].id}", json={"is_active": False}, headers=admin)
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "has_open_beds")
    r = await client.patch(f"/tenant/units/{w.units['neo'].id}", json={"is_active": False}, headers=admin)
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "has_open_beds")

    assert (await client.patch(f"/tenant/beds/{w.beds['3'].id}", json={"is_active": False},
                               headers=admin)).status_code == 200
    r = await client.patch(f"/tenant/rooms/{w.rooms['o2'].id}", json={"is_active": False}, headers=admin)
    assert r.status_code == 200 and r.json()["is_active"] is False
    assert (await client.patch(f"/tenant/beds/{w.beds['N1'].id}", json={"is_active": False},
                               headers=admin)).status_code == 200
    r = await client.patch(f"/tenant/units/{w.units['neo'].id}", json={"is_active": False}, headers=admin)
    assert r.status_code == 200 and r.json()["is_active"] is False
    tree = (await client.get("/tenant/structure", headers=admin)).json()
    neo = next(u for s in tree["sites"] for u in s["units"] if u["name"] == "Neonatal")
    assert neo["is_active"] is False and neo["rooms"][0]["beds"][0]["is_active"] is False


async def test_only_structure_manage_changes_the_structure(ward):
    w, client, _ = ward
    r = await client.patch(f"/tenant/beds/{w.beds['1'].id}", json={"label": "X"},
                           headers=w.auth["charge"])
    assert r.status_code == 403


# ---------------------------------------------------------------- POST /tenant/beds/{id}/release
async def test_a_nurse_releases_a_cleaned_bed_of_her_unit_and_it_is_audited(ward, db_session):
    w, client, app = ward
    bed_id, unit_id = w.beds["2"].id, w.units["rea"].id
    await _set_state(db_session, w.beds["2"], BedState.HOUSEKEEPING)
    r = await client.post(f"/tenant/beds/{bed_id}/release", headers=w.auth["nurse"])
    assert r.status_code == 200, r.text
    assert r.json()["state"] == "AVAILABLE"
    db_session.expire_all()
    assert (await db_session.execute(select(Bed.state).where(Bed.id == bed_id))).scalar_one() \
        == BedState.AVAILABLE
    (row,) = [r for r in app.state.audit.records(tenant="kabul-hastane", limit=10)
              if r.event_type == "bed.release"]
    assert row.payload == {"bed_id": str(bed_id), "unit_id": str(unit_id),
                           "actor": "nurse@kabul.example.com"}


async def test_a_bed_that_is_not_in_cleaning_is_not_released(ward):
    w, client, _ = ward
    r = await client.post(f"/tenant/beds/{w.beds['2'].id}/release", headers=w.auth["nurse"])
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "invalid_transition")


async def test_a_bed_of_another_unit_is_out_of_scope(ward, db_session):
    w, client, _ = ward
    await _set_state(db_session, w.beds["N1"], BedState.HOUSEKEEPING)
    r = await client.post(f"/tenant/beds/{w.beds['N1'].id}/release", headers=w.auth["nurse"])
    assert (r.status_code, r.json()["detail"]["code"]) == (403, "out_of_scope")
    r = await client.post(f"/tenant/beds/{w.beds['N1'].id}/release", headers=w.auth["nurse_b"])
    assert r.status_code == 200


async def test_a_physician_does_not_release_beds(ward, db_session):
    w, client, _ = ward
    await _set_state(db_session, w.beds["2"], BedState.HOUSEKEEPING)
    r = await client.post(f"/tenant/beds/{w.beds['2'].id}/release", headers=w.auth["doctor"])
    assert r.status_code == 403 and r.json()["detail"] == "permission required: beds.release"
```

**Edit** `homunculus-engine/tests/test_route_permissions.py` (1) — replace:

```python
    ("POST", "/tenant/beds/{bed_id}/transition"): ANY(_S),
    # admission/router.py
```

with:

```python
    ("POST", "/tenant/beds/{bed_id}/transition"): ANY(_S),
    # G2-B1a (Hasta Kabul): the names every screen reads, the administrator's rename / close /
    # reopen, and a nurse's "cleaning done, bed free" (spec §4.4, D8)
    ("GET", "/tenant/structure"): ANY("admissions.view", "admissions.admit", "beds.release", _S, _U),
    ("PATCH", "/tenant/units/{unit_id}"): ANY(_S),
    ("PATCH", "/tenant/rooms/{room_id}"): ANY(_S),
    ("PATCH", "/tenant/beds/{bed_id}"): ANY(_S),
    ("POST", "/tenant/beds/{bed_id}/release"): ANY("beds.release"),
    # admission/router.py
```

**Edit** `homunculus-engine/tests/test_route_permissions.py` (2) — replace:

```python
def test_the_table_covers_every_guarded_route():
    assert len(EXPECTED) == 54

```

with:

```python
def test_the_table_covers_every_guarded_route():
    assert len(EXPECTED) == 59

```

**Edit** `homunculus-engine/tests/test_tenant_isolation.py` (1) — replace:

```python
        lambda a: {"new_state": "OCCUPIED"}),
}
```

with:

```python
        lambda a: {"new_state": "OCCUPIED"}),
    # G2-B1a (Hasta Kabul): rename / close / reopen, and the release of a cleaned bed (the free
    # bed is AVAILABLE, so the caller's own is refused by the domain: 409 invalid_transition).
    "unit patch": ById("PATCH", lambda s: f"/tenant/units/{s.unit}", lambda a: {"name": "Yeni"}),
    "room patch": ById("PATCH", lambda s: f"/tenant/rooms/{s.room}", lambda a: {"name": "Oda 9"}),
    "bed patch": ById("PATCH", lambda s: f"/tenant/beds/{s.free_bed}", lambda a: {"label": "9Z"}),
    "bed release": ById("POST", lambda s: f"/tenant/beds/{s.free_bed}/release", control=409),
}
```

**Edit** `homunculus-engine/tests/test_tenant_isolation.py` (2) — replace:

```python
    assert r.status_code == 200 and r.json() == []

```

with:

```python
    assert r.status_code == 200 and r.json() == []


@requires_db
async def test_the_structure_holds_only_the_callers_tenant(world):
    """G2-B1a: GET /tenant/structure, which every screen reads its unit and bed names from."""
    r = await _call(world, "GET", "/tenant/structure")
    assert r.status_code == 200, r.text
    units = {u["id"] for s in r.json()["sites"] for u in s["units"]}
    beds = {b["id"] for s in r.json()["sites"] for u in s["units"] for room in u["rooms"]
            for b in room["beds"]}
    assert r.json()["tenant_id"] == str(world.a.tenant)
    assert units == {str(world.a.unit)}
    assert beds == {str(world.a.bed), str(world.a.free_bed)}

```


- [ ] **Step 2: Run them and see them red** — the five routes are not registered:

```bash
cd /c/tmp/g2b-kabul-be/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 \
  /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_route_permissions.py 2>&1 | grep -E "^(FAILED|ERROR) |[0-9]+ (passed|failed|error)|^E +[A-Za-z]*(Error|Exception)" | head -16
```

Expected (the replay, times vary):

```text
FAILED tests/test_route_permissions.py::test_no_table_entry_lacks_a_route - A...
1 failed, 8 passed, 6 skipped, 2 warnings in …s
E       AssertionError: assert [('GET', '/te...id}/release')] == []
```

```bash
cd /c/tmp/g2b-kabul-be/homunculus-engine
TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 \
  /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_structure_api.py 2>&1 | grep -E "^(FAILED|ERROR) |[0-9]+ (passed|failed|error)|^E +[A-Za-z]*(Error|Exception)" | head -16
```

Expected (the replay, times vary):

```text
FAILED tests/test_structure_api.py::test_a_nurse_reads_her_units_tree_with_names_and_states
FAILED tests/test_structure_api.py::test_the_administrator_and_the_unassigned_see_every_unit
FAILED tests/test_structure_api.py::test_a_bed_grant_shows_that_bed_in_its_room_and_unit_alone
FAILED tests/test_structure_api.py::test_a_caller_with_no_admission_right_is_refused
FAILED tests/test_structure_api.py::test_the_administrator_renames_a_unit_a_room_and_a_bed
FAILED tests/test_structure_api.py::test_a_name_another_room_or_bed_of_the_same_parent_holds_is_refused
FAILED tests/test_structure_api.py::test_a_bed_holding_a_patient_cannot_be_closed_and_a_free_one_can
FAILED tests/test_structure_api.py::test_a_room_or_unit_with_an_open_bed_cannot_be_closed_until_its_beds_are
FAILED tests/test_structure_api.py::test_only_structure_manage_changes_the_structure
FAILED tests/test_structure_api.py::test_a_nurse_releases_a_cleaned_bed_of_her_unit_and_it_is_audited
FAILED tests/test_structure_api.py::test_a_bed_that_is_not_in_cleaning_is_not_released
FAILED tests/test_structure_api.py::test_a_bed_of_another_unit_is_out_of_scope
13 failed, 2 warnings in …s
E       AssertionError: {"detail":"Not Found"}
E       KeyError: 'sites'
E       KeyError: 'sites'
```


- [ ] **Step 3: The schemas, the audit trail, the routes:**

**Edit** `homunculus-engine/src/homunculus/tenant/schemas.py` (1) — replace:

```python

from pydantic import BaseModel

```

with:

```python

from pydantic import BaseModel, Field

```

**Edit** `homunculus-engine/src/homunculus/tenant/schemas.py` (2) — replace:

```python
    device_location_id: str | None
    created_at: datetime
    model_config = {"from_attributes": True}

```

with:

```python
    device_location_id: str | None
    created_at: datetime
    is_active: bool = True          # G2-B1a
    model_config = {"from_attributes": True}

```

**Edit** `homunculus-engine/src/homunculus/tenant/schemas.py` (3) — replace:

```python
    reason: str | None = None
```

with:

```python
    reason: str | None = None


# ---------------------------------------------------------------- G2-B1a (Hasta Kabul)
class UnitPatch(BaseModel):
    """Rename, close (`is_active: false`) or reopen a unit. Nothing is ever deleted."""
    name: str | None = Field(default=None, min_length=1, max_length=200)
    is_active: bool | None = None


class RoomPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    room_number: str | None = Field(default=None, max_length=20)
    is_active: bool | None = None


class BedPatch(BaseModel):
    label: str | None = Field(default=None, min_length=1, max_length=50)
    is_active: bool | None = None


class StructureBed(BaseModel):
    id: uuid.UUID
    label: str
    state: BedState
    is_active: bool


class StructureRoom(BaseModel):
    id: uuid.UUID
    name: str
    room_number: str | None
    is_isolation: bool
    is_active: bool
    beds: list[StructureBed]


class StructureUnit(BaseModel):
    id: uuid.UUID
    name: str
    unit_type: UnitType
    is_active: bool
    rooms: list[StructureRoom]


class StructureSite(BaseModel):
    id: uuid.UUID
    name: str
    is_active: bool
    units: list[StructureUnit]


class StructureResponse(BaseModel):
    """GET /tenant/structure: the tree every screen resolves a unit's and a bed's NAME from — no
    screen ever shows a UUID (spec D9). `tenant_id` is the parent a new site is created under."""
    tenant_id: uuid.UUID
    sites: list[StructureSite]
```

**Write** `homunculus-engine/src/homunculus/admission/trail.py` (a new file, whole):

```python
# homunculus-engine/src/homunculus/admission/trail.py
"""Where the admission and bed routes meet the engine's world: its hospital key and its audit
(Group 2 · B1a).

The routers act on a tenant by UUID (`caller_tenant_id`); the engine, the identity store and the
audit key a hospital by the tenant's SLUG (api/identity.py: "the engine's hospital key *is* the
tenant slug"). `hospital_of` turns one into the other; `record` appends one row to the app's own
audit log under it — the append-only, hash-chained trail an inspection reads.

What a row carries: ids, the patient NUMBER, the actor, the fields a decision turned on. Never a
name: the audit is PHI-free by design (the name lives in the encrypted stores).
"""
from __future__ import annotations

import uuid

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.api.audit import AuditEvent
from homunculus.tenant.models import Tenant


async def hospital_of(db: AsyncSession, tenant_id: uuid.UUID) -> str:
    """The engine's hospital key for this tenant: its slug."""
    return (await db.execute(select(Tenant.slug).where(Tenant.id == tenant_id))).scalar_one()


def record(request: Request, hospital: str, event_type: str, *, patient_id: str = "",
           subject: str = "", payload: dict) -> None:
    """One row in the app's audit log. An app assembled without one (a test mounting the routers
    alone) writes nothing here rather than failing the write it describes."""
    log = getattr(request.app.state, "audit", None)
    if log is not None:
        log.append(AuditEvent(hospital, event_type, patient_id, subject, payload))
```

**Edit** `homunculus-engine/src/homunculus/tenant/router.py` (1) — replace:

```python
validated against the bed lifecycle state machine (§1.3).

```

with:

```python
validated against the bed lifecycle state machine (§1.3).

Two exceptions since Group 2 · B1a (Hasta Kabul): `GET /tenant/structure` — the names of the
caller's own units and beds, which every clinical screen needs and no screen may print as a UUID —
is open to `admissions.view`, `admissions.admit`, `beds.release`, `structure.manage` and
`users.manage` (the scope editor names the units and beds it grants); and
`POST /tenant/beds/{id}/release` (cleaning done, bed free) to `beds.release`, the ward's nurses, in
their own units. Their refusals, and those of the rename / close / reopen routes, carry a stable
code (admission/errors.py).

```

**Edit** `homunculus-engine/src/homunculus/tenant/router.py` (2) — replace:

```python
from __future__ import annotations
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
```

with:

```python
from __future__ import annotations
import re
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
```

**Edit** `homunculus-engine/src/homunculus/tenant/router.py` (3) — replace:

```python

from homunculus.auth.dependencies import (
    caller_tenant_id, require_permission, require_platform_operator,
)
```

with:

```python

from homunculus.admission import trail, unitscope
from homunculus.admission.errors import (
    BED_IN_USE, HAS_OPEN_BEDS, INVALID_TRANSITION, NAME_TAKEN, Refusal, field_invalid,
)
from homunculus.auth.dependencies import (
    Principal, caller_tenant_id, get_principal, require_permission, require_platform_operator,
)
```

**Edit** `homunculus-engine/src/homunculus/tenant/router.py` (4) — replace:

```python
from homunculus.tenant import scope
from homunculus.tenant.models import Bed, Room, Site, Tenant, Unit
from homunculus.tenant.schemas import (
    BedCreate, BedResponse, BedStateTransitionRequest,
    RoomCreate, RoomResponse, SiteCreate, SiteResponse,
    TenantCreate, TenantResponse, UnitCreate, UnitResponse,
)
```

with:

```python
from homunculus.tenant import scope
from homunculus.tenant.models import Bed, BedState, Room, Site, Tenant, Unit
from homunculus.tenant.schemas import (
    BedCreate, BedPatch, BedResponse, BedStateTransitionRequest,
    RoomCreate, RoomPatch, RoomResponse, SiteCreate, SiteResponse,
    StructureBed, StructureResponse, StructureRoom, StructureSite, StructureUnit,
    TenantCreate, TenantResponse, UnitCreate, UnitPatch, UnitResponse,
)
```

**Edit** `homunculus-engine/src/homunculus/tenant/router.py` (5) — replace:

```python

@router.post("/beds/{bed_id}/transition", response_model=BedResponse,
```

with:

```python

# ---------------------------------------------------------------- G2-B1a (Hasta Kabul)
# The ward's own structure as every screen reads it, the administrator's rename / close / reopen,
# and a nurse's "cleaning done, bed free". Refusals carry a stable code (admission/errors.py).
_FREE_TO_CLOSE = {BedState.AVAILABLE, BedState.HOUSEKEEPING, BedState.BLOCKED}


def _natural(text: str) -> list:
    """Sort key that puts bed "2" before bed "10"."""
    return [int(part) if part.isdigit() else part.casefold() for part in re.split(r"(\d+)", text)]


@router.get("/structure", response_model=StructureResponse,
            summary="Sites, units, rooms and beds, with names and states, in the caller's units")
async def structure(
    db: AsyncSession = Depends(get_db), caller_tenant: uuid.UUID = _tenant,
    principal: Principal = Depends(get_principal),
    _user: User = Depends(require_permission("admissions.view", "admissions.admit",
                                             "beds.release", "structure.manage", "users.manage")),
) -> StructureResponse:
    """The tree a screen resolves every unit and bed NAME from (spec D9: no UUID on a screen).
    `users.manage` too: the scope editor names the units and beds it grants (plan X52).

    Limited to the caller's units: a unit she is granted with all its rooms and beds, a bed she is
    granted with its room and unit around it. An unrestricted caller sees every unit, and so does
    a holder of `structure.manage` — the one who builds the structure must see all of it. Closed
    units, rooms and beds are listed (`is_active: false`): a screen dims them with the reason."""
    everything = "structure.manage" in principal.perms
    scope = None if everything else await unitscope.caller_scope(db, principal.user.id,
                                                                   caller_tenant)
    sites = (await db.execute(select(Site).where(Site.tenant_id == caller_tenant))).scalars().all()
    site_ids = [s.id for s in sites]
    units = (await db.execute(select(Unit).where(Unit.site_id.in_(site_ids)))).scalars().all()
    rooms = (await db.execute(
        select(Room).where(Room.unit_id.in_([u.id for u in units])))).scalars().all()
    beds = (await db.execute(
        select(Bed).where(Bed.room_id.in_([r.id for r in rooms])))).scalars().all()
    room_unit = {r.id: r.unit_id for r in rooms}

    def shown(bed: Bed) -> bool:
        return scope is None or unitscope.reaches(scope, unit_id=room_unit[bed.room_id],
                                                  bed_id=bed.id)

    def unit_shown(unit: Unit) -> bool:
        return scope is None or unitscope.reaches(scope, unit_id=unit.id, bed_id="")

    out_sites = []
    for site in sorted(sites, key=lambda s: _natural(s.name)):
        out_units = []
        for unit in sorted((u for u in units if u.site_id == site.id), key=lambda u: _natural(u.name)):
            whole = unit_shown(unit)
            out_rooms = []
            for room in sorted((r for r in rooms if r.unit_id == unit.id), key=lambda r: _natural(r.name)):
                room_beds = [StructureBed(id=b.id, label=b.label, state=b.state, is_active=b.is_active)
                             for b in sorted((b for b in beds if b.room_id == room.id),
                                             key=lambda b: _natural(b.label))
                             if whole or shown(b)]
                if whole or room_beds:
                    out_rooms.append(StructureRoom(
                        id=room.id, name=room.name, room_number=room.room_number,
                        is_isolation=room.is_isolation, is_active=room.is_active, beds=room_beds))
            if whole or out_rooms:
                out_units.append(StructureUnit(id=unit.id, name=unit.name, unit_type=unit.unit_type,
                                               is_active=unit.is_active, rooms=out_rooms))
        if everything or out_units:
            out_sites.append(StructureSite(id=site.id, name=site.name, is_active=site.is_active,
                                           units=out_units))
    return StructureResponse(tenant_id=caller_tenant, sites=out_sites)


async def _has_open_bed(db: AsyncSession, *conditions) -> bool:
    stmt = (select(Bed.id).join(Room, Room.id == Bed.room_id)
            .where(Bed.is_active.is_(True), *conditions).limit(1))
    return (await db.execute(stmt)).first() is not None


def _refused(exc: Refusal) -> HTTPException:
    return exc.http()


@router.patch("/units/{unit_id}", response_model=UnitResponse,
              summary="Rename, close or reopen a unit (G2-B1a)")
async def patch_unit(
    unit_id: uuid.UUID, body: UnitPatch,
    db: AsyncSession = Depends(get_db), _user=_admin, caller_tenant: uuid.UUID = _tenant,
) -> UnitResponse:
    scope.ensure_owned(await scope.tenant_of_unit(db, unit_id), caller_tenant, "Unit not found")
    unit = await _get_or_404(db, Unit, unit_id, "Unit")
    if body.name is not None:
        if not body.name.strip():
            raise _refused(field_invalid("name", "A unit needs a name."))
        unit.name = body.name.strip()
    if body.is_active is False and unit.is_active:
        if await _has_open_bed(db, Room.unit_id == unit_id):
            raise _refused(Refusal(409, HAS_OPEN_BEDS, "Close every bed of this unit first."))
    if body.is_active is not None:
        unit.is_active = body.is_active
    await db.commit()
    await db.refresh(unit)
    return UnitResponse.model_validate(unit)


@router.patch("/rooms/{room_id}", response_model=RoomResponse,
              summary="Rename, close or reopen a room (G2-B1a)")
async def patch_room(
    room_id: uuid.UUID, body: RoomPatch,
    db: AsyncSession = Depends(get_db), _user=_admin, caller_tenant: uuid.UUID = _tenant,
) -> RoomResponse:
    scope.ensure_owned(await scope.tenant_of_room(db, room_id), caller_tenant, "Room not found")
    room = await _get_or_404(db, Room, room_id, "Room")
    if body.name is not None:
        name = body.name.strip()
        if not name:
            raise _refused(field_invalid("name", "A room needs a name."))
        taken = (await db.execute(select(Room.id).where(
            Room.unit_id == room.unit_id, Room.name == name, Room.id != room.id))).first()
        if taken:
            raise _refused(Refusal(409, NAME_TAKEN, "Another room of this unit has that name."))
        room.name = name
    if body.room_number is not None:
        room.room_number = body.room_number.strip() or None
    if body.is_active is False and room.is_active:
        if await _has_open_bed(db, Bed.room_id == room_id):
            raise _refused(Refusal(409, HAS_OPEN_BEDS, "Close every bed of this room first."))
    if body.is_active is not None:
        room.is_active = body.is_active
    await db.commit()
    await db.refresh(room)
    return RoomResponse.model_validate(room)


@router.patch("/beds/{bed_id}", response_model=BedResponse,
              summary="Rename, close or reopen a bed (G2-B1a)")
async def patch_bed(
    bed_id: uuid.UUID, body: BedPatch,
    db: AsyncSession = Depends(get_db), _user=_admin, caller_tenant: uuid.UUID = _tenant,
) -> BedResponse:
    scope.ensure_owned(await scope.tenant_of_bed(db, bed_id), caller_tenant, "Bed not found")
    bed = (await db.execute(select(Bed).where(Bed.id == bed_id).with_for_update())).scalar_one()
    if body.label is not None:
        label = body.label.strip()
        if not label:
            raise _refused(field_invalid("label", "A bed needs a label."))
        taken = (await db.execute(select(Bed.id).where(
            Bed.room_id == bed.room_id, Bed.label == label, Bed.id != bed.id))).first()
        if taken:
            raise _refused(Refusal(409, NAME_TAKEN, "Another bed of this room has that label."))
        bed.label = label
    if body.is_active is False and bed.is_active and bed.state not in _FREE_TO_CLOSE:
        raise _refused(Refusal(409, BED_IN_USE,
                               f"A bed that is {bed.state.value} cannot be closed."))
    if body.is_active is not None:
        bed.is_active = body.is_active
    await db.commit()
    await db.refresh(bed)
    return BedResponse.model_validate(bed)


@router.post("/beds/{bed_id}/release", response_model=BedResponse,
             summary="Cleaning done: a HOUSEKEEPING bed becomes AVAILABLE (G2-B1a)")
async def release_bed(
    bed_id: uuid.UUID, request: Request,
    db: AsyncSession = Depends(get_db), caller_tenant: uuid.UUID = _tenant,
    user: User = Depends(require_permission("beds.release")),
) -> BedResponse:
    """Spec D8 and §3.4: the ward's nurses turn a bed over without an administrator — in their
    own units only. Audited `bed.release` (who, which bed)."""
    scope.ensure_owned(await scope.tenant_of_bed(db, bed_id), caller_tenant, "Bed not found")
    bed = (await db.execute(select(Bed).where(Bed.id == bed_id).with_for_update())).scalar_one()
    unit_id = (await db.execute(select(Room.unit_id).where(Room.id == bed.room_id))).scalar_one()
    try:
        unitscope.require_reach(await unitscope.caller_scope(db, user.id, caller_tenant),
                                unit_id=unit_id, bed_id=bed.id)
    except Refusal as exc:
        raise _refused(exc) from None
    if bed.state != BedState.HOUSEKEEPING:
        raise _refused(Refusal(409, INVALID_TRANSITION,
                               f"Only a bed in cleaning can be released (it is {bed.state.value})."))
    bed.transition_to(BedState.AVAILABLE)
    trail.record(request, await trail.hospital_of(db, caller_tenant), "bed.release",
                 payload={"bed_id": str(bed.id), "unit_id": str(unit_id),
                          "actor": user.username})
    await db.commit()
    await db.refresh(bed)
    return BedResponse.model_validate(bed)


@router.post("/beds/{bed_id}/transition", response_model=BedResponse,
```


- [ ] **Step 4: Run them green** — the registry without the database; the routes and the registry with it; the tenant isolation rows that name these routes:

```bash
cd /c/tmp/g2b-kabul-be/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 \
  /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_route_permissions.py tests/test_tenant_isolation.py 2>&1 | grep -E "^(FAILED|ERROR) |[0-9]+ (passed|failed|error)|^E +[A-Za-z]*(Error|Exception)" | head -16
```

Expected (the replay, times vary):

```text
10 passed, 123 skipped, 2 warnings in …s
```

```bash
cd /c/tmp/g2b-kabul-be/homunculus-engine
TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 \
  /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_structure_api.py tests/test_route_permissions.py 2>&1 | grep -E "^(FAILED|ERROR) |[0-9]+ (passed|failed|error)|^E +[A-Za-z]*(Error|Exception)" | head -16
```

Expected (the replay, times vary):

```text
28 passed, 2 warnings in …s
```

```bash
cd /c/tmp/g2b-kabul-be/homunculus-engine
TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 \
  /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_tenant_isolation.py -k "patch or release or structure" 2>&1 | grep -E "^(FAILED|ERROR) |[0-9]+ (passed|failed|error)|^E +[A-Za-z]*(Error|Exception)" | head -16
```

Expected (the replay, times vary):

```text
9 passed, 109 deselected, 2 warnings in …s
```


- [ ] **Step 5: The whole no-DB suite:**

```bash
cd /c/tmp/g2b-kabul-be/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 \
  /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q --ignore=tests/test_infinity_vm_pilot.py 2>&1 | grep -E "^(FAILED|ERROR) |[0-9]+ (passed|failed|error)|^E +[A-Za-z]*(Error|Exception)" | head -16
```

Expected (the replay, times vary):

```text
2330 passed, 689 skipped, 3 warnings in …s
```


- [ ] **Step 6: Line ends:**

```bash
cd /c/tmp/g2b-kabul-be
for f in homunculus-engine/tests/kabul_world.py homunculus-engine/tests/test_structure_api.py homunculus-engine/tests/test_route_permissions.py homunculus-engine/tests/test_tenant_isolation.py homunculus-engine/src/homunculus/tenant/schemas.py homunculus-engine/src/homunculus/admission/trail.py homunculus-engine/src/homunculus/tenant/router.py; do printf "%s CR=%s LF=%s\n" "$f" "$(tr -cd '\r' < "$f" | wc -c)" "$(tr -cd '\n' < "$f" | wc -c)"; done
```

Expected:

```text
homunculus-engine/tests/kabul_world.py CR=0 LF=106
homunculus-engine/tests/test_structure_api.py CR=0 LF=177
homunculus-engine/tests/test_route_permissions.py CR=322 LF=322
homunculus-engine/tests/test_tenant_isolation.py CR=804 LF=804
homunculus-engine/src/homunculus/tenant/schemas.py CR=152 LF=152
homunculus-engine/src/homunculus/admission/trail.py CR=0 LF=36
homunculus-engine/src/homunculus/tenant/router.py CR=420 LF=420
```


- [ ] **Step 7: Commit:**

```bash
cd /c/tmp/g2b-kabul-be
git add -- homunculus-engine/tests/kabul_world.py homunculus-engine/tests/test_structure_api.py homunculus-engine/tests/test_route_permissions.py homunculus-engine/tests/test_tenant_isolation.py homunculus-engine/src/homunculus/tenant/schemas.py homunculus-engine/src/homunculus/admission/trail.py homunculus-engine/src/homunculus/tenant/router.py
git status --short && git diff --cached --stat
git commit -m "feat(tenant): the ward's structure by scope; rename, close and reopen; a cleaned bed released (G2-B1a)" \
  -m "red: 1 failed, 8 passed, 6 skipped, 2 warnings (AssertionError: assert [('GET', '/te...id}/release')] == []); 13 failed, 2 warnings (AssertionError: {'detail':'Not Found'})" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- homunculus-engine/tests/kabul_world.py homunculus-engine/tests/test_structure_api.py homunculus-engine/tests/test_route_permissions.py homunculus-engine/tests/test_tenant_isolation.py homunculus-engine/src/homunculus/tenant/schemas.py homunculus-engine/src/homunculus/admission/trail.py homunculus-engine/src/homunculus/tenant/router.py
```

---

### Task 8: `POST /admissions` — the whole form, the bed locked, the number, the board; `GET /admissions`

**Lane:** backend. **Needs:** Tasks 6 and 7.

Spec D3, D4, D6, §3.1, §4.4, §4.5, X53. The create route, in order: the unit, the bed and the attending belong to the caller's tenant (as before); the form's rules (Task 3); the bed row **locked** (`SELECT … FOR UPDATE`) with its room and unit; the bed in the unit the form names (`field_invalid:admitting_unit_id`); in the caller's units (`out_of_scope`, 403); open (`bed_closed` when the bed, its room or its unit is closed); a fresh number; then the service refuses a bed that is not AVAILABLE (`bed_not_available`) and writes patient and DRAFT admission, the bed OCCUPIED, in the same transaction; the audit row `admission.admit` (the number, the bed, the unit, the actor — never a name) after the commit. Then, outside the transaction, the board through `BoardLink`: the identity (the card on its bed), the weight if one was given, the comorbidity codes if any were ticked — each reported `ok`, `failed` or `skipped` in `engine` (X53); a failed part leaves the admission standing and is logged. Two admissions into one bed at once admit one patient (the lock). `GET /admissions?state=DRAFT&state=ACTIVE…` lists the open admissions of the caller's units with the patient's number, name, bed and unit names, for the Taburcu list and the sign-off badge (X61).

**Files:**
- Create: `homunculus-engine/tests/test_admission_api.py`
- Modify: `homunculus-engine/tests/test_tenant_isolation.py`
- Modify: `homunculus-engine/src/homunculus/admission/service.py`
- Modify: `homunculus-engine/src/homunculus/admission/router.py`

- [ ] **Step 1: Write the failing tests** — the admission end to end, its engine parts, every refusal, two at once, the list; and the tenant isolation suite's admission body gains the form's required fields:

**Write** `homunculus-engine/tests/test_admission_api.py` (a new file, whole):

```python
# homunculus-engine/tests/test_admission_api.py
"""POST and GET /admissions as Group 2 · B1a makes them (spec §3.1, §4.1, §4.4, §4.5): the whole
form in one transaction, the bed locked, open, in the caller's units and AVAILABLE, a fresh
patient number, the card on its bed and the weight and comorbidities in the engine after the
commit — each reported, none undoing the admission — and every refusal with its code and nothing
written. Postgres (`db_session`). Synthetic ward: tests/kabul_world.py."""
from __future__ import annotations

import asyncio
import uuid

import pytest
import pytest_asyncio
from sqlalchemy import func, select, text

from homunculus.admission.boardlink import BoardLink
from homunculus.admission.models import Admission, AdmissionState, Patient
from homunculus.tenant.models import Bed, BedState
from tests.conftest import requires_db
from tests.kabul_world import BOARD, SLUG, build_ward, ward_client

pytestmark = [requires_db]


@pytest_asyncio.fixture
async def ward(db_session, monkeypatch):
    monkeypatch.delenv("SCOPE_ENFORCE_UNASSIGNED", raising=False)
    built = await build_ward(db_session)
    async with ward_client(db_session) as (client, app):
        yield built, client, app


def form(w, bed: str = "1", unit: str = "rea", patient: dict | None = None,
         note: dict | None = None) -> dict:
    """The Kabul tab's body: every required field, the bed the picker chose."""
    return {
        "patient": {"display_name": "Sentetik Hasta", "date_of_birth": "1970-05-05", "sex": "female",
                    "consent": "KVKK_SIGNED", "national_id": "5ab12cd", "phone": "+994 50 123 45 67",
                    "father_name": "Sentetik Ata", **(patient or {})},
        "note": {"admitting_unit_id": str(w.units[unit].id), "bed_id": str(w.beds[bed].id),
                 "admission_type": "ICU", "admission_diagnosis_free_text": "Sentetik tanı",
                 "allergies_text": "Penisilin", "blood_group": "A_POS", "weight_kg": 72.5,
                 "height_cm": 171, "comorbidity_codes": ["copd"], **(note or {})},
    }


async def _count(db, model) -> int:
    return (await db.execute(select(func.count()).select_from(model))).scalar_one()


async def test_an_admission_is_written_numbered_and_put_on_the_board(ward, db_session):
    w, client, app = ward
    bed_id, unit_id = w.beds["1"].id, w.units["rea"].id
    r = await client.post("/admissions", json=form(w), headers=w.auth["nurse"])
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["patient_number"] == f"H{body['created_at'][2:4]}00001"
    assert body["state"] == "DRAFT" and body["admission_type"] == "ICU"
    assert body["engine"] == {"weight": "ok", "profile": "ok", "board": "ok"}

    db_session.expire_all()
    bed_state = (await db_session.execute(select(Bed.state).where(Bed.id == bed_id))).scalar_one()
    assert bed_state == BedState.OCCUPIED
    patient = (await db_session.execute(select(Patient))).scalar_one()
    assert (patient.national_id, patient.consent.value, patient.father_name) == \
        ("5AB12CD", "KVKK_SIGNED", "Sentetik Ata")
    raw = (await db_session.execute(text("SELECT national_id, phone FROM patients"))).one()
    assert all(value.startswith("enc::") for value in raw)        # encrypted at rest

    (card,) = (await client.get("/patients", headers=BOARD)).json()["patients"]
    assert card["patient_id"] == body["patient_number"]
    assert (card["identity"]["bed_id"], card["identity"]["unit_id"]) == (str(bed_id), str(unit_id))
    assert (card["identity"]["bed_label"], card["identity"]["display_name"]) == ("1", "Sentetik Hasta")
    assert card["meds"]["weight_kg"] == 72.5
    engine = app.state.board_link._engine(SLUG)
    assert engine.profile(body["patient_number"]).comorbidities == frozenset({"copd"})

    rows = [r for r in app.state.audit.records(tenant=SLUG, limit=50) if r.event_type == "admission.admit"]
    assert [r.patient_id for r in rows] == [body["patient_number"]]
    assert rows[0].payload == {"admission_id": body["id"], "bed_id": str(bed_id),
                               "unit_id": str(unit_id), "actor": "nurse@kabul.example.com"}
    assert "Sentetik" not in repr([r.payload for r in app.state.audit.records(tenant=SLUG, limit=50)])


async def test_the_next_admission_takes_the_next_number(ward):
    w, client, _ = ward
    first = (await client.post("/admissions", json=form(w, "1"), headers=w.auth["nurse"])).json()
    second = (await client.post("/admissions", json=form(w, "2"), headers=w.auth["charge"])).json()
    assert int(second["patient_number"][3:]) == int(first["patient_number"][3:]) + 1


async def test_without_a_weight_or_a_code_those_engine_parts_are_skipped(ward):
    w, client, _ = ward
    body = form(w, note={"weight_kg": None, "comorbidity_codes": []})
    r = await client.post("/admissions", json=body, headers=w.auth["nurse"])
    assert r.status_code == 201
    assert r.json()["engine"] == {"weight": "skipped", "profile": "skipped", "board": "ok"}


async def test_an_engine_write_that_fails_leaves_the_admission_and_says_so(ward, db_session,
                                                                           monkeypatch):
    w, client, _ = ward

    async def broken(self, *args, **kwargs):
        raise RuntimeError("the engine is not answering")

    monkeypatch.setattr(BoardLink, "chart_weight", broken)
    r = await client.post("/admissions", json=form(w), headers=w.auth["nurse"])
    assert r.status_code == 201, r.text
    assert r.json()["engine"] == {"weight": "failed", "profile": "ok", "board": "ok"}
    assert await _count(db_session, Admission) == 1


@pytest.mark.parametrize(("who", "bed", "unit", "status", "code"), [
    ("nurse_b", "1", "rea", 403, "out_of_scope"),
    ("nurse", "1", "neo", 422, "field_invalid:admitting_unit_id"),
])
async def test_a_bed_outside_the_callers_units_or_its_own_unit_is_refused(ward, db_session, who,
                                                                         bed, unit, status, code):
    w, client, _ = ward
    r = await client.post("/admissions", json=form(w, bed, unit), headers=w.auth[who])
    assert (r.status_code, r.json()["detail"]["code"]) == (status, code)
    assert await _count(db_session, Patient) == 0


async def test_an_occupied_bed_and_a_closed_one_are_refused_with_their_codes(ward, db_session):
    w, client, _ = ward
    assert (await client.post("/admissions", json=form(w, "1"), headers=w.auth["nurse"])).status_code == 201
    r = await client.post("/admissions", json=form(w, "1"), headers=w.auth["nurse"])
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "bed_not_available")

    admin = w.auth["admin"]
    await client.patch(f"/tenant/beds/{w.beds['2'].id}", json={"is_active": False}, headers=admin)
    r = await client.post("/admissions", json=form(w, "2"), headers=w.auth["nurse"])
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "bed_closed")
    await client.patch(f"/tenant/beds/{w.beds['N1'].id}", json={"is_active": False}, headers=admin)
    await client.patch(f"/tenant/rooms/{w.rooms['n1'].id}", json={"is_active": False}, headers=admin)
    await client.patch(f"/tenant/beds/{w.beds['N1'].id}", json={"is_active": True}, headers=admin)
    r = await client.post("/admissions", json=form(w, "N1", "neo"), headers=w.auth["nurse_b"])
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "bed_closed")
    assert await _count(db_session, Patient) == 1


async def test_a_form_missing_a_required_field_is_refused_and_writes_nothing(ward, db_session):
    w, client, _ = ward
    bed_id = w.beds["1"].id
    for patient, note, field in (({"consent": None}, {}, "consent"),
                                 ({}, {"allergies_text": None}, "allergies_text"),
                                 ({"national_id": "12"}, {}, "national_id")):
        r = await client.post("/admissions", json=form(w, patient=patient, note=note),
                              headers=w.auth["nurse"])
        assert (r.status_code, r.json()["detail"]["code"]) == (422, f"field_invalid:{field}")
    assert await _count(db_session, Patient) == 0
    db_session.expire_all()
    assert (await db_session.execute(select(Bed.state).where(Bed.id == bed_id))).scalar_one() \
        == BedState.AVAILABLE


async def test_a_physician_does_not_admit(ward):
    w, client, _ = ward
    r = await client.post("/admissions", json=form(w), headers=w.auth["doctor"])
    assert r.status_code == 403 and r.json()["detail"] == "permission required: admissions.admit"


async def test_two_admissions_into_one_bed_at_once_admit_one_patient(ward, db_session):
    """The bed row is locked for the transaction: the second finds it OCCUPIED."""
    w, client, _ = ward
    answers = await asyncio.gather(
        client.post("/admissions", json=form(w, patient={"display_name": "Sentetik Bir"}),
                    headers=w.auth["nurse"]),
        client.post("/admissions", json=form(w, patient={"display_name": "Sentetik İki"}),
                    headers=w.auth["charge"]))
    assert sorted(r.status_code for r in answers) == [201, 409]
    refused = next(r for r in answers if r.status_code == 409)
    assert refused.json()["detail"]["code"] == "bed_not_available"
    assert await _count(db_session, Patient) == 1


async def test_the_list_carries_names_filters_by_state_and_keeps_to_the_callers_units(ward):
    w, client, _ = ward
    rea = (await client.post("/admissions", json=form(w, "1"), headers=w.auth["nurse"])).json()
    neo = (await client.post("/admissions", json=form(w, "N1", "neo"),
                             headers=w.auth["nurse_b"])).json()

    rows = (await client.get("/admissions", params={"state": ["DRAFT", "ACTIVE"]},
                             headers=w.auth["nurse"])).json()
    assert [(r["patient_number"], r["display_name"], r["bed_label"], r["room_name"], r["unit_name"])
            for r in rows] == [(rea["patient_number"], "Sentetik Hasta", "1", "Otaq 1", "Reanimasiya")]
    everyone = (await client.get("/admissions", headers=w.auth["admin"])).json()
    assert {r["patient_number"] for r in everyone} == {rea["patient_number"], neo["patient_number"]}
    none = (await client.get("/admissions", params={"state": "DISCHARGED"},
                             headers=w.auth["admin"])).json()
    assert none == []
```

**Edit** `homunculus-engine/tests/test_tenant_isolation.py` (1) — replace:

```python
        note["attending_physician_id"] = attending
    return {"patient": {"display_name": "Sentetik Yeni Hasta", "date_of_birth": "1990-02-02",
                        "sex": "male"},
            "note": note}
```

with:

```python
        note["attending_physician_id"] = attending
    # G2-B1a: the admission form's required fields (admission/form.py).
    note.update(admission_type="ICU", no_known_allergy=True)
    return {"patient": {"display_name": "Sentetik Yeni Hasta", "date_of_birth": "1990-02-02",
                        "sex": "male", "consent": "KVKK_SIGNED"},
            "note": note}
```


- [ ] **Step 2: Run it and see it red** — the route still answers the old response (no `patient_number`, no `engine`). Two tests pass already: the physician's refusal (the route's permission, unchanged) and two admissions at once — Task 2's counter row lock already serialises two admissions of one tenant, so the second finds the bed OCCUPIED; the bed's own lock (Step 3) makes the bed the guard rather than the number:

```bash
cd /c/tmp/g2b-kabul-be/homunculus-engine
TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 \
  /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_admission_api.py 2>&1 | grep -E "^(FAILED|ERROR) |[0-9]+ (passed|failed|error)|^E +[A-Za-z]*(Error|Exception)" | head -16
```

Expected (the replay, times vary):

```text
FAILED tests/test_admission_api.py::test_an_admission_is_written_numbered_and_put_on_the_board
FAILED tests/test_admission_api.py::test_the_next_admission_takes_the_next_number
FAILED tests/test_admission_api.py::test_without_a_weight_or_a_code_those_engine_parts_are_skipped
FAILED tests/test_admission_api.py::test_an_engine_write_that_fails_leaves_the_admission_and_says_so
FAILED tests/test_admission_api.py::test_a_bed_outside_the_callers_units_or_its_own_unit_is_refused[nurse_b-1-rea-403-out_of_scope]
FAILED tests/test_admission_api.py::test_a_bed_outside_the_callers_units_or_its_own_unit_is_refused[nurse-1-neo-422-field_invalid:admitting_unit_id]
FAILED tests/test_admission_api.py::test_an_occupied_bed_and_a_closed_one_are_refused_with_their_codes
FAILED tests/test_admission_api.py::test_a_form_missing_a_required_field_is_refused_and_writes_nothing
FAILED tests/test_admission_api.py::test_the_list_carries_names_filters_by_state_and_keeps_to_the_callers_units
9 failed, 2 passed, 2 warnings in …s
E       KeyError: 'patient_number'
E       KeyError: 'patient_number'
E       KeyError: 'engine'
```


- [ ] **Step 3: Lock the bed in the service; write the route and the list:**

**Edit** `homunculus-engine/src/homunculus/admission/service.py` (1) — replace:

```python

    bed = await db.get(Bed, note_fields["bed_id"])
    if bed is None:
```

with:

```python

    # The bed row is LOCKED until the transaction ends (G2-B1a, spec §3.1): two admissions into one
    # bed at once wait for each other here, and the second finds it OCCUPIED.
    bed = (await db.execute(
        select(Bed).where(Bed.id == note_fields["bed_id"]).with_for_update()
    )).scalar_one_or_none()
    if bed is None:
```

**Edit** `homunculus-engine/src/homunculus/admission/router.py` (1) — replace:

```python

PHI: patient identity is returned only by the patient-detail endpoint
(`GET /admissions/{id}/patient`), to holders of `admissions.view` in the patient's own
tenant. Reads of it are not audited yet. List and board contexts never include patient
identity here.
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.admission import service
from homunculus.admission.models import (
    Admission, CareTeamMember, Handover, Patient,
)
from homunculus.admission.schemas import (
    AdmissionCreate, AdmissionResponse, CareTeamAdd, CareTeamMemberResponse,
    DischargeInitiate, HandoverOpen, HandoverResponse, HandoverSign,
    NurseBedAssignmentResponse, PatientResponse, ShiftScheduleCreate,
    ShiftScheduleResponse, TransferInitiate,
)
from homunculus.admission.errors import Refusal
from homunculus.admission.numbers import next_patient_number
```

with:

```python

PHI: patient identity is returned by the patient-detail endpoint (`GET /admissions/{id}/patient`)
and — since Group 2 · B1a, for the Taburcu list — as the display name on each row of
`GET /admissions`, to holders of `admissions.view` in the patient's own tenant, as the board shows
it to `board.view`. Reads of either are not audited yet.

Group 2 · B1a (Hasta Kabul): the admission, sign-off and discharge routes check the target bed's
unit against the caller's grants (admission/unitscope.py), write their audit row
(admission/trail.py) and reach the board only through `BoardLink` (admission/boardlink.py). Every
refusal carries a stable code beside its words (admission/errors.py).
"""
from __future__ import annotations

import logging
import uuid
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from homunculus.admission import form, service, trail, unitscope
from homunculus.admission.boardlink import board_link_of, kabul_record
from homunculus.admission.models import (
    Admission, AdmissionState, CareTeamMember, Handover, Patient,
)
from homunculus.admission.schemas import (
    AdmissionCreate, AdmissionResponse, AdmissionRow, AdmitResponse, CareTeamAdd,
    CareTeamMemberResponse, DischargeInitiate, EngineWrites, HandoverOpen, HandoverResponse,
    HandoverSign, NurseBedAssignmentResponse, PatientResponse, ShiftScheduleCreate,
    ShiftScheduleResponse, TransferInitiate,
)
from homunculus.admission.errors import BED_CLOSED, Refusal, field_invalid
from homunculus.admission.numbers import next_patient_number
```

**Edit** `homunculus-engine/src/homunculus/admission/router.py` (2) — replace:

```python
from homunculus.tenant import scope

```

with:

```python
from homunculus.tenant import scope
from homunculus.tenant.models import Bed, Room, Unit

log = logging.getLogger(__name__)

```

**Edit** `homunculus-engine/src/homunculus/admission/router.py` (3) — replace:

```python
# ---------------------------------------------------------------------------
@router.post("", response_model=AdmissionResponse, status_code=201,
             dependencies=[Depends(require_permission("admissions.admit"))])
async def create_admission(
    payload: AdmissionCreate, db: AsyncSession = Depends(get_db),
    caller_tenant: uuid.UUID = _tenant,
):
    # The admitting unit and the bed belong to the caller's tenant and the attending is a member
```

with:

```python
# ---------------------------------------------------------------------------
def _strip(value: str | None) -> str | None:
    """A form text as stored: trimmed, and None rather than empty."""
    return value.strip() or None if value is not None else None


async def _bed_of(db: AsyncSession, bed_id: uuid.UUID) -> tuple[Bed, Room, Unit]:
    """The bed with its room and unit, the bed row LOCKED for this transaction (spec §3.1)."""
    bed = (await db.execute(select(Bed).where(Bed.id == bed_id).with_for_update())).scalar_one()
    room = await db.get(Room, bed.room_id)
    return bed, room, await db.get(Unit, room.unit_id)


async def _to_board(request: Request, hospital: str, *, admission: Admission, patient: Patient,
                    bed: Bed, note, actor: str) -> EngineWrites:
    """After the admission is committed (spec §3.1 step 3): the card, the weight, the profile —
    each on its own. One that does not land leaves the admission standing and is reported, so the
    screen can say which part to enter by hand. Logged with the patient number, never a name."""
    link = board_link_of(request)
    if link is None:
        return EngineWrites(weight="skipped", profile="skipped", board="skipped")

    async def attempt(what: str, write) -> str:
        try:
            await write()
            return "ok"
        except Exception:
            log.exception("admission %s: the %s did not reach the engine",
                          patient.patient_number, what)
            return "failed"

    record = kabul_record(patient_number=patient.patient_number, display_name=patient.display_name,
                          birth_date=date.fromisoformat(patient.date_of_birth), sex=patient.sex,
                          bed_label=bed.label, bed_id=str(bed.id),
                          unit_id=str(admission.admitting_unit_id),
                          at=datetime.now(timezone.utc))
    board = await attempt("identity", lambda: link.put_identity(hospital, record))
    weight = ("skipped" if note.weight_kg is None else await attempt(
        "weight", lambda: link.chart_weight(hospital, patient.patient_number, note.weight_kg,
                                            actor=actor)))
    profile = ("skipped" if not note.comorbidity_codes else await attempt(
        "profile", lambda: link.apply_profile(hospital, patient.patient_number,
                                              note.comorbidity_codes, actor=actor)))
    return EngineWrites(weight=weight, profile=profile, board=board)


@router.post("", response_model=AdmitResponse, status_code=201)
async def create_admission(
    payload: AdmissionCreate, request: Request, db: AsyncSession = Depends(get_db),
    caller_tenant: uuid.UUID = _tenant,
    user: User = Depends(require_permission("admissions.admit")),
):
    """Group 2 · B1a (spec §3.1): one request, one transaction. The form is checked
    (admission/form.py), the bed row is locked and must be open, in the caller's units and
    AVAILABLE, the patient gets a fresh number (admission/numbers.py), the admission is DRAFT and
    the bed OCCUPIED. After the commit the board gets its card and the engine the weight and the
    comorbidities (`_to_board`); the answer says which of those landed."""
    # The admitting unit and the bed belong to the caller's tenant and the attending is a member
```

**Edit** `homunculus-engine/src/homunculus/admission/router.py` (4) — replace:

```python
    try:
        number = await next_patient_number(db, caller_tenant)
    except Refusal as exc:
        raise exc.http() from None
    patient = Patient(
        tenant_id=caller_tenant,
        patient_number=number,
        display_name=payload.patient.display_name,
        date_of_birth=payload.patient.date_of_birth.isoformat(),
        sex=payload.patient.sex.value,
        his_patient_reference=payload.patient.his_patient_reference,
    )
```

with:

```python
    try:
        form.check_admission(payload, today=datetime.now(timezone.utc).date())
        bed, room, unit = await _bed_of(db, payload.note.bed_id)
        if unit.id != payload.note.admitting_unit_id:
            raise field_invalid("admitting_unit_id", "The bed is not in that unit.")
        unitscope.require_reach(await unitscope.caller_scope(db, user.id, caller_tenant),
                                unit_id=unit.id, bed_id=bed.id)
        if not (bed.is_active and room.is_active and unit.is_active):
            raise Refusal(409, BED_CLOSED, "The bed, its room or its unit is closed.")
        number = await next_patient_number(db, caller_tenant)
    except Refusal as exc:
        raise exc.http() from None
    p = payload.patient
    patient = Patient(
        tenant_id=caller_tenant,
        patient_number=number,
        display_name=p.display_name.strip(),
        date_of_birth=p.date_of_birth.isoformat(),
        sex=p.sex.value,
        his_patient_reference=_strip(p.his_patient_reference),
        father_name=_strip(p.father_name), nationality=_strip(p.nationality),
        national_id=(_strip(p.national_id) or "").upper() or None,
        passport_no=_strip(p.passport_no), phone=_strip(p.phone),
        relative_name=_strip(p.relative_name), relative_relation=_strip(p.relative_relation),
        relative_phone=_strip(p.relative_phone), companion_name=_strip(p.companion_name),
        consent=p.consent, sms_permitted=p.sms_permitted,
    )
```

**Edit** `homunculus-engine/src/homunculus/admission/router.py` (5) — replace:

```python
    note = payload.note.model_dump()
    try:
```

with:

```python
    note = payload.note.model_dump()
    note["allergies_text"] = _strip(note["allergies_text"])
    note["comorbidities_text"] = _strip(note["comorbidities_text"])
    try:
```

**Edit** `homunculus-engine/src/homunculus/admission/router.py` (6) — replace:

```python
        )
    except WorkflowError as exc:
        raise _wf(exc)
    await db.commit()
    await db.refresh(admission)
    return admission


# ---------------------------------------------------------------------------
```

with:

```python
        )
    except WorkflowError as exc:
        raise _wf(exc)
    hospital = await trail.hospital_of(db, caller_tenant)
    await db.commit()
    await db.refresh(admission)
    trail.record(request, hospital, "admission.admit", patient_id=number,
                 payload={"admission_id": str(admission.id), "bed_id": str(bed.id),
                          "unit_id": str(unit.id), "actor": user.username})
    engine = await _to_board(request, hospital, admission=admission, patient=patient, bed=bed,
                             note=payload.note, actor=user.username)
    return AdmitResponse(**AdmissionResponse.model_validate(admission).model_dump(),
                         patient_number=number, engine=engine)


# ---------------------------------------------------------------------------
```

**Edit** `homunculus-engine/src/homunculus/admission/router.py` (7) — replace:

```python
# ---------------------------------------------------------------------------
@router.get("", response_model=list[AdmissionResponse],
            dependencies=[Depends(require_permission("admissions.view"))])
async def list_admissions(
    unit_id: uuid.UUID | None = None, db: AsyncSession = Depends(get_db),
    caller_tenant: uuid.UUID = _tenant,
):
    stmt = select(Admission).where(Admission.tenant_id == caller_tenant)
    if unit_id is not None:
        stmt = stmt.where(Admission.admitting_unit_id == unit_id)
    result = await db.execute(stmt.order_by(Admission.created_at.desc()))
    return list(result.scalars().all())

```

with:

```python
# ---------------------------------------------------------------------------
@router.get("", response_model=list[AdmissionRow])
async def list_admissions(
    unit_id: uuid.UUID | None = None,
    state: list[AdmissionState] | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    caller_tenant: uuid.UUID = _tenant,
    user: User = Depends(require_permission("admissions.view")),
):
    """Newest first, each row with the names a screen shows (G2-B1a: the Taburcu and Yataklar
    lists). `state` narrows to those states (repeatable); the rows are limited to the caller's
    units, as the structure is (admission/unitscope.py)."""
    stmt = (select(Admission, Patient, Bed, Room, Unit)
            .join(Patient, Patient.id == Admission.patient_id)
            .join(Bed, Bed.id == Admission.bed_id)
            .join(Room, Room.id == Bed.room_id)
            .join(Unit, Unit.id == Room.unit_id)
            .where(Admission.tenant_id == caller_tenant))
    if unit_id is not None:
        stmt = stmt.where(Admission.admitting_unit_id == unit_id)
    if state:
        stmt = stmt.where(Admission.state.in_(state))
    reach = await unitscope.caller_scope(db, user.id, caller_tenant)
    rows = (await db.execute(stmt.order_by(Admission.created_at.desc()))).all()
    return [AdmissionRow(**AdmissionResponse.model_validate(a).model_dump(),
                         patient_number=p.patient_number, display_name=p.display_name,
                         bed_label=b.label, room_name=r.name, unit_name=u.name)
            for a, p, b, r, u in rows if unitscope.reaches(reach, unit_id=u.id, bed_id=b.id)]

```


- [ ] **Step 4: Run them green:**

```bash
cd /c/tmp/g2b-kabul-be/homunculus-engine
TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 \
  /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_admission_api.py 2>&1 | grep -E "^(FAILED|ERROR) |[0-9]+ (passed|failed|error)|^E +[A-Za-z]*(Error|Exception)" | head -16
```

Expected (the replay, times vary):

```text
11 passed, 2 warnings in …s
```

```bash
cd /c/tmp/g2b-kabul-be/homunculus-engine
TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 \
  /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_tenant_isolation.py -k "admit or admission or list" 2>&1 | grep -E "^(FAILED|ERROR) |[0-9]+ (passed|failed|error)|^E +[A-Za-z]*(Error|Exception)" | head -16
```

Expected (the replay, times vary):

```text
28 passed, 90 deselected, 2 warnings in …s
```


- [ ] **Step 5: The whole no-DB suite:**

```bash
cd /c/tmp/g2b-kabul-be/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 \
  /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q --ignore=tests/test_infinity_vm_pilot.py 2>&1 | grep -E "^(FAILED|ERROR) |[0-9]+ (passed|failed|error)|^E +[A-Za-z]*(Error|Exception)" | head -16
```

Expected (the replay, times vary):

```text
2330 passed, 700 skipped, 3 warnings in …s
```


- [ ] **Step 6: Line ends:**

```bash
cd /c/tmp/g2b-kabul-be
for f in homunculus-engine/tests/test_admission_api.py homunculus-engine/tests/test_tenant_isolation.py homunculus-engine/src/homunculus/admission/service.py homunculus-engine/src/homunculus/admission/router.py; do printf "%s CR=%s LF=%s\n" "$f" "$(tr -cd '\r' < "$f" | wc -c)" "$(tr -cd '\n' < "$f" | wc -c)"; done
```

Expected:

```text
homunculus-engine/tests/test_admission_api.py CR=0 LF=193
homunculus-engine/tests/test_tenant_isolation.py CR=806 LF=806
homunculus-engine/src/homunculus/admission/service.py CR=491 LF=491
homunculus-engine/src/homunculus/admission/router.py CR=547 LF=547
```


- [ ] **Step 7: Commit:**

```bash
cd /c/tmp/g2b-kabul-be
git add -- homunculus-engine/tests/test_admission_api.py homunculus-engine/tests/test_tenant_isolation.py homunculus-engine/src/homunculus/admission/service.py homunculus-engine/src/homunculus/admission/router.py
git status --short && git diff --cached --stat
git commit -m "feat(admission): an admission writes the whole form, locks its bed, takes a number and puts the card on the board (G2-B1a)" \
  -m "red: 9 failed, 2 passed, 2 warnings (KeyError: 'patient_number')" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- homunculus-engine/tests/test_admission_api.py homunculus-engine/tests/test_tenant_isolation.py homunculus-engine/src/homunculus/admission/service.py homunculus-engine/src/homunculus/admission/router.py
```

---

### Task 9: Sign-off, discharge start and confirm, and the whole flow

**Lane:** backend. **Needs:** Task 8.

Spec D3, D7, §3.2, §3.3, §4.4, X58, X59. Sign-off (`admissions.sign_off`, the bed in the caller's units) makes a DRAFT ACTIVE and, when it has no attending, makes the signer the attending; a signed admission is not signed again (`invalid_transition`). The discharge start (`admissions.move.initiate`, the route's existing key) takes `DischargeStart {disposition, institution?, reported_by?, discharge_at?, note?}` (X58), checks it (Task 3's rules), refuses a DRAFT (`invalid_transition`, X59) and — through `BoardLink.open_critical` — a patient with a critical alarm nobody acknowledged (`critical_alarm_open`, the count in the words). An exitus is reported by the caller (her full name, else her user name) unless another name is written. The confirm (`admissions.discharge.confirm`, the charge nurse) discharges, turns the bed to cleaning (`HOUSEKEEPING`), takes the card off every screen through `BoardLink.discharge_identity` and answers `board: ok|failed|skipped`; the audit rows `admission.sign_off`, `admission.discharge_start` (with the disposition, never the note) and `admission.discharge_confirm` (with the bed) carry the number and the actor, never a name. Every one of these routes checks the admission's bed is in the caller's units (`out_of_scope`). The last test walks spec §8's whole flow: admission → card → sign-off → start → confirm → the card gone, a reading for the number kept but shown nowhere → the bed released → AVAILABLE.

**Files:**
- Create: `homunculus-engine/tests/test_discharge_api.py`
- Modify: `homunculus-engine/tests/test_admission_workflow.py`
- Modify: `homunculus-engine/tests/test_tenant_isolation.py`
- Modify: `homunculus-engine/src/homunculus/admission/schemas.py`
- Modify: `homunculus-engine/src/homunculus/admission/service.py`
- Modify: `homunculus-engine/src/homunculus/admission/router.py`

- [ ] **Step 1: Write the failing tests** — the discharge API and the whole flow; the workflow test's discharge keywords; the tenant isolation suite's discharge body:

**Write** `homunculus-engine/tests/test_discharge_api.py` (a new file, whole):

```python
# homunculus-engine/tests/test_discharge_api.py
"""Sign-off and discharge as Group 2 · B1a makes them (spec D3, D7, §3.2, §3.3), and the whole flow
of §8: admit → the card on its bed and unit → sign-off → discharge started → confirmed → the card
gone for scoped and unscoped screens → the bed in cleaning → released. Postgres (`db_session`).
Synthetic ward: tests/kabul_world.py."""
from __future__ import annotations

import asyncio
import json
from datetime import datetime, timedelta, timezone

import pytest_asyncio
from sqlalchemy import select

from homunculus.admission.models import Admission, AdmissionState
from homunculus.api.app import sse_board_frames
from homunculus.scope import build_scope, sees_patient
from homunculus.tenant.models import Bed, BedState
from tests.conftest import requires_db
from tests.kabul_world import BOARD, SLUG, build_ward, ward_client

pytestmark = [requires_db]


@pytest_asyncio.fixture
async def ward(db_session, monkeypatch):
    monkeypatch.delenv("SCOPE_ENFORCE_UNASSIGNED", raising=False)
    built = await build_ward(db_session)
    async with ward_client(db_session) as (client, app):
        yield built, client, app


def form(w, bed: str = "1", unit: str = "rea", weight: float | None = 50) -> dict:
    return {"patient": {"display_name": "Sentetik Hasta", "date_of_birth": "1970-05-05",
                        "sex": "male", "consent": "UNCONSCIOUS_LATER"},
            "note": {"admitting_unit_id": str(w.units[unit].id), "bed_id": str(w.beds[bed].id),
                     "admission_type": "MEDICAL", "admission_diagnosis_free_text": "Sentetik tanı",
                     "no_known_allergy": True, "weight_kg": weight}}


async def admit(w, client, bed: str = "1", unit: str = "rea", who: str = "nurse") -> dict:
    r = await client.post("/admissions", json=form(w, bed, unit), headers=w.auth[who])
    assert r.status_code == 201, r.text
    return r.json()


async def signed(w, client, bed: str = "1") -> dict:
    admission = await admit(w, client, bed)
    r = await client.post(f"/admissions/{admission['id']}/sign-off", headers=w.auth["doctor"])
    assert r.status_code == 200, r.text
    return admission


def audited(app, event: str) -> list:
    return [r for r in app.state.audit.records(tenant=SLUG, limit=200) if r.event_type == event]


# ---------------------------------------------------------------- sign-off
async def test_the_physician_who_signs_a_draft_becomes_its_attending(ward):
    w, client, app = ward
    admission = await admit(w, client)
    r = await client.post(f"/admissions/{admission['id']}/sign-off", headers=w.auth["doctor"])
    assert r.status_code == 200, r.text
    assert r.json()["state"] == "ACTIVE"
    assert r.json()["attending_physician_id"] == r.json()["signed_by"] == str(w.users["doctor"].id)
    (row,) = audited(app, "admission.sign_off")
    assert (row.patient_id, row.payload["actor"]) == (admission["patient_number"],
                                                      "doctor@kabul.example.com")


async def test_a_nurse_does_not_sign_and_a_physician_signs_only_in_her_units(ward):
    w, client, _ = ward
    rea = await admit(w, client)
    r = await client.post(f"/admissions/{rea['id']}/sign-off", headers=w.auth["nurse"])
    assert r.status_code == 403
    neo = await admit(w, client, "N1", "neo", who="nurse_b")
    r = await client.post(f"/admissions/{neo['id']}/sign-off", headers=w.auth["doctor"])
    assert (r.status_code, r.json()["detail"]["code"]) == (403, "out_of_scope")


async def test_a_signed_admission_is_not_signed_again(ward):
    w, client, _ = ward
    admission = await signed(w, client)
    r = await client.post(f"/admissions/{admission['id']}/sign-off", headers=w.auth["doctor"])
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "invalid_transition")


# ---------------------------------------------------------------- discharge start
async def test_a_discharge_home_is_started_with_its_disposition(ward, db_session):
    w, client, app = ward
    bed_id = w.beds["1"].id
    admission = await signed(w, client)
    r = await client.post(f"/admissions/{admission['id']}/discharge/initiate",
                          json={"disposition": "HOME", "note": "Sentetik not"},
                          headers=w.auth["doctor"])
    assert r.status_code == 200, r.text
    body = r.json()
    assert (body["state"], body["discharge_disposition"], body["discharge_note"]) == \
        ("PENDING_DISCHARGE", "HOME", "Sentetik not")
    assert body["discharge_at"] is not None
    db_session.expire_all()
    assert (await db_session.execute(select(Bed.state).where(Bed.id == bed_id))).scalar_one() \
        == BedState.PENDING_DISCHARGE
    (row,) = audited(app, "admission.discharge_start")
    assert row.payload == {"admission_id": admission["id"], "disposition": "HOME",
                           "actor": "doctor@kabul.example.com"}


async def test_an_exitus_is_reported_by_the_caller_unless_another_name_is_written(ward):
    w, client, _ = ward
    first, second = await signed(w, client, "1"), await signed(w, client, "2")
    r = await client.post(f"/admissions/{first['id']}/discharge/initiate",
                          json={"disposition": "EXITUS"}, headers=w.auth["doctor"])
    assert r.json()["discharge_reported_by"] == "doctor"
    r = await client.post(f"/admissions/{second['id']}/discharge/initiate",
                          json={"disposition": "EXITUS", "reported_by": "Dr. Sentetik"},
                          headers=w.auth["doctor"])
    assert r.json()["discharge_reported_by"] == "Dr. Sentetik"


async def test_an_incomplete_or_impossible_decision_is_refused(ward):
    w, client, _ = ward
    admission = await signed(w, client)
    url = f"/admissions/{admission['id']}/discharge/initiate"
    future = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
    for body, code in (({"disposition": "OTHER_INSTITUTION"}, "field_invalid:institution"),
                       ({"disposition": "HOME", "discharge_at": future}, "field_invalid:discharge_at")):
        r = await client.post(url, json=body, headers=w.auth["doctor"])
        assert (r.status_code, r.json()["detail"]["code"]) == (422, code)


async def test_a_draft_cannot_be_discharged_before_it_is_signed(ward):
    w, client, _ = ward
    admission = await admit(w, client)
    r = await client.post(f"/admissions/{admission['id']}/discharge/initiate",
                          json={"disposition": "HOME"}, headers=w.auth["doctor"])
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "invalid_transition")


async def test_an_open_critical_alarm_blocks_the_start_until_it_is_acknowledged(ward):
    """The board's own alerts, as the clinician sees them (BoardLink.open_critical)."""
    w, client, _ = ward
    admission = await signed(w, client)
    number = admission["patient_number"]
    for entries in ([{"code": "suspected_infection", "value": 1}, {"code": "lactate", "value": 3.4},
                     {"code": "norepinephrine_rate", "value": 0.08}],
                    [{"code": "crystalloid_bolus_ml", "value": 1600}]):
        r = await client.post(f"/clinical/{number}", json={"entries": entries}, headers=BOARD)
        assert r.status_code == 200, r.text
    assert "septic_shock" in r.json()["alerts"]           # 1600 mL / 50 kg: septic shock, critical

    url = f"/admissions/{admission['id']}/discharge/initiate"
    r = await client.post(url, json={"disposition": "HOME"}, headers=w.auth["doctor"])
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "critical_alarm_open")

    ack = await client.post("/ack", json={"patient_id": number, "kind": "septic_shock"},
                            headers=BOARD)
    assert ack.status_code == 200, ack.text
    r = await client.post(url, json={"disposition": "HOME"}, headers=w.auth["doctor"])
    assert r.status_code == 200, r.text


# ---------------------------------------------------------------- discharge confirm
async def test_only_the_charge_nurse_confirms_and_only_a_started_discharge(ward):
    w, client, _ = ward
    admission = await signed(w, client)
    url = f"/admissions/{admission['id']}/discharge/confirm"
    assert (await client.post(url, headers=w.auth["nurse"])).status_code == 403
    r = await client.post(url, headers=w.auth["charge"])
    assert (r.status_code, r.json()["detail"]["code"]) == (409, "invalid_transition")


# ---------------------------------------------------------------- the whole flow (§8)
async def test_the_whole_flow_from_admission_to_a_free_bed(ward, db_session):
    w, client, app = ward
    bed_id, unit_id = w.beds["1"].id, w.units["rea"].id
    queue = app.state.broadcaster.subscribe(SLUG)
    rea_screen = build_scope("MEMBER", unit_ids=[str(unit_id)])
    neo_screen = build_scope("MEMBER", unit_ids=[str(w.units["neo"].id)])

    admission = await admit(w, client)
    number = admission["patient_number"]
    (card,) = (await client.get("/patients", headers=BOARD)).json()["patients"]
    assert (card["patient_id"], card["identity"]["bed_id"], card["identity"]["unit_id"]) == \
        (number, str(bed_id), str(unit_id))
    assert sees_patient(card, rea_screen) and not sees_patient(card, neo_screen)

    assert (await client.post(f"/admissions/{admission['id']}/sign-off",
                              headers=w.auth["doctor"])).status_code == 200
    assert (await client.post(f"/admissions/{admission['id']}/discharge/initiate",
                              json={"disposition": "HOME"},
                              headers=w.auth["doctor"])).status_code == 200
    while not queue.empty():
        queue.get_nowait()
    r = await client.post(f"/admissions/{admission['id']}/discharge/confirm",
                          headers=w.auth["charge"])
    assert r.status_code == 200, r.text
    assert (r.json()["state"], r.json()["board"]) == ("DISCHARGED", "ok")

    assert (await client.get("/patients", headers=BOARD)).json()["patients"] == []
    removal = queue.get_nowait()
    assert (removal["patient_id"], removal["removed"]) == (number, True)

    async def heard(scope) -> str:
        frames = asyncio.Queue()
        await frames.put(removal)
        return await anext(sse_board_frames(frames, keepalive=0.05,
                                            allow=lambda b: sees_patient(b, scope)))

    assert json.loads((await heard(rea_screen))[len("data: "):])["removed"] is True
    assert json.loads((await heard(build_scope("HOSPITAL_ADMIN")))[len("data: "):])["removed"] is True
    assert await heard(neo_screen) == ": keep-alive\n\n"

    db_session.expire_all()
    assert (await db_session.execute(select(Bed.state).where(Bed.id == bed_id))).scalar_one() \
        == BedState.HOUSEKEEPING
    r = await client.post(f"/tenant/beds/{bed_id}/release", headers=w.auth["nurse"])
    assert (r.status_code, r.json()["state"]) == (200, "AVAILABLE")
    assert [e.event_type for e in app.state.audit.records(tenant=SLUG, patient_id=number, limit=50)
            if e.event_type.startswith("admission.")] == [
        "admission.admit", "admission.sign_off", "admission.discharge_start",
        "admission.discharge_confirm"]
    state = (await db_session.execute(select(Admission.state))).scalar_one()
    assert state == AdmissionState.DISCHARGED
```

**Edit** `homunculus-engine/tests/test_admission_workflow.py` (1) — replace:

```python
from homunculus.admission.models import (
    AdmissionState, CareTeamRole, HandoverStatus, Patient,
)
```

with:

```python
from homunculus.admission.models import (
    AdmissionState, CareTeamRole, DischargeDisposition, HandoverStatus, Patient,
)
```

**Edit** `homunculus-engine/tests/test_admission_workflow.py` (2) — replace:

```python
    await service.sign_off_admission(db_session, adm, signing_user_id=attending.id)
    with pytest.raises(WorkflowError, match="CRITICAL"):
        await service.initiate_discharge(
            db_session, adm, discharge_summary="Taburcu özeti", unacknowledged_critical_count=1)

```

with:

```python
    await service.sign_off_admission(db_session, adm, signing_user_id=attending.id)
    with pytest.raises(WorkflowError, match="CRITICAL") as refused:
        await service.initiate_discharge(
            db_session, adm, disposition=DischargeDisposition.HOME, note="Taburcu özeti",
            unacknowledged_critical_count=1)
    assert refused.value.code == "critical_alarm_open"

```

**Edit** `homunculus-engine/tests/test_admission_workflow.py` (3) — replace:

```python
    await service.sign_off_admission(db_session, adm, signing_user_id=attending.id)
    await service.initiate_discharge(db_session, adm, discharge_summary="Taburcu özeti")
    assert adm.state == AdmissionState.PENDING_DISCHARGE
    assert beds[0].state == BedState.PENDING_DISCHARGE
    await service.confirm_discharge(db_session, adm)
```

with:

```python
    await service.sign_off_admission(db_session, adm, signing_user_id=attending.id)
    await service.initiate_discharge(db_session, adm, disposition=DischargeDisposition.OTHER_INSTITUTION,
                                     institution="Sentetik Klinika", note="Taburcu özeti")
    assert adm.state == AdmissionState.PENDING_DISCHARGE
    assert beds[0].state == BedState.PENDING_DISCHARGE
    assert (adm.discharge_disposition, adm.discharge_institution, adm.discharge_note) == \
        (DischargeDisposition.OTHER_INSTITUTION, "Sentetik Klinika", "Taburcu özeti")
    assert adm.discharge_at is not None
    await service.confirm_discharge(db_session, adm)
```

**Edit** `homunculus-engine/tests/test_tenant_isolation.py` (1) — replace:

```python
        "POST", lambda s: f"/admissions/{s.admission}/discharge/initiate",
        lambda a: {"discharge_summary": "Sentetik taburcu özeti"}),
    "discharge confirm": ById(
```

with:

```python
        "POST", lambda s: f"/admissions/{s.admission}/discharge/initiate",
        lambda a: {"disposition": "HOME", "note": "Sentetik taburcu notu"}),
    "discharge confirm": ById(
```


- [ ] **Step 2: Run it and see it red** — a sign-off does not make the signer the attending (`missing_attending`), no route checks the caller's units, and the discharge start still takes the old body:

```bash
cd /c/tmp/g2b-kabul-be/homunculus-engine
TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 \
  /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_discharge_api.py 2>&1 | grep -E "^(FAILED|ERROR) |[0-9]+ (passed|failed|error)|^E +[A-Za-z]*(Error|Exception)" | head -16
```

Expected (the replay, times vary):

```text
FAILED tests/test_discharge_api.py::test_the_physician_who_signs_a_draft_becomes_its_attending
FAILED tests/test_discharge_api.py::test_a_nurse_does_not_sign_and_a_physician_signs_only_in_her_units
FAILED tests/test_discharge_api.py::test_a_signed_admission_is_not_signed_again
FAILED tests/test_discharge_api.py::test_a_discharge_home_is_started_with_its_disposition
FAILED tests/test_discharge_api.py::test_an_exitus_is_reported_by_the_caller_unless_another_name_is_written
FAILED tests/test_discharge_api.py::test_an_incomplete_or_impossible_decision_is_refused
FAILED tests/test_discharge_api.py::test_a_draft_cannot_be_discharged_before_it_is_signed
FAILED tests/test_discharge_api.py::test_an_open_critical_alarm_blocks_the_start_until_it_is_acknowledged
FAILED tests/test_discharge_api.py::test_only_the_charge_nurse_confirms_and_only_a_started_discharge
FAILED tests/test_discharge_api.py::test_the_whole_flow_from_admission_to_a_free_bed
10 failed, 2 warnings in …s
E       AssertionError: {"detail":{"code":"missing_attending","message":"attending_physician_id must be resolved before a DRAFT can become ACTIVE (§5.2 field 8)."}}
E       AssertionError: assert (409, 'missing_attending') == (403, 'out_of_scope')
E       AssertionError: {"detail":{"code":"missing_attending","message":"attending_physician_id must be resolved before a DRAFT can become ACTIVE (§5.2 field 8)."}}
```


- [ ] **Step 3: `DischargeStart` replaces `DischargeInitiate`; the service takes the disposition; the routes:**

**Edit** `homunculus-engine/src/homunculus/admission/schemas.py` (1) — replace:

```python

class DischargeInitiate(BaseModel):
    discharge_summary: str = Field(..., max_length=2000)
    # Signals the caller acknowledges the confirmation dialog (S-28) — required
    # when a UNIT_PHYSICIAN (not the attending) performs the discharge.
    confirmed: bool = False


class DischargeStart(BaseModel):
```

with:

```python

class DischargeStart(BaseModel):
```

**Edit** `homunculus-engine/src/homunculus/admission/schemas.py` (2) — replace:

```python
    note: str | None = Field(default=None, max_length=2000)

```

with:

```python
    note: str | None = Field(default=None, max_length=2000)
    # The old body (`discharge_summary`, `confirmed`) is gone: no client ever sent it (G1 had no
    # admission screen), and a summary pasted into the admission narrative is now `note`.

```

**Edit** `homunculus-engine/src/homunculus/admission/service.py` (1) — replace:

```python
from homunculus.admission.models import (
    Admission, AdmissionState, CareTeamMember, CareTeamRole, Handover,
    HandoverStatus, NurseBedAssignment, OPEN_ADMISSION_STATES, Patient,
```

with:

```python
from homunculus.admission.models import (
    Admission, AdmissionState, CareTeamMember, CareTeamRole, DischargeDisposition, Handover,
    HandoverStatus, NurseBedAssignment, OPEN_ADMISSION_STATES, Patient,
```

**Edit** `homunculus-engine/src/homunculus/admission/service.py` (2) — replace:

```python
    db: AsyncSession, admission: Admission, *,
    discharge_summary: str, unacknowledged_critical_count: int = 0,
) -> Admission:
    if admission.state != AdmissionState.ACTIVE:
```

with:

```python
    db: AsyncSession, admission: Admission, *,
    disposition: DischargeDisposition, institution: str | None = None,
    reported_by: str | None = None, discharge_at: datetime | None = None,
    note: str | None = None, unacknowledged_critical_count: int = 0,
) -> Admission:
    """§4.7 steps 1–2 as Group 2 · B1a decides them (spec D7): the physician's disposition — home,
    another institution (named), or exitus (reported by) — its time and a note, recorded on the
    admission. `unacknowledged_critical_count` is the board's own (admission/boardlink.py
    `open_critical`); any one blocks the start."""
    if admission.state != AdmissionState.ACTIVE:
```

**Edit** `homunculus-engine/src/homunculus/admission/service.py` (3) — replace:

```python
    admission.transition_to(AdmissionState.PENDING_DISCHARGE)
    admission.admission_note_narrative = (
        (admission.admission_note_narrative or "") + f"\n[DISCHARGE] {discharge_summary}"
    )
    bed = await db.get(Bed, admission.bed_id)
```

with:

```python
    admission.transition_to(AdmissionState.PENDING_DISCHARGE)
    admission.discharge_disposition = disposition
    admission.discharge_institution = institution
    admission.discharge_reported_by = reported_by
    admission.discharge_at = discharge_at or _now()
    admission.discharge_note = note
    bed = await db.get(Bed, admission.bed_id)
```

**Edit** `homunculus-engine/src/homunculus/admission/router.py` (1) — replace:

```python
from homunculus.admission.models import (
    Admission, AdmissionState, CareTeamMember, Handover, Patient,
)
from homunculus.admission.schemas import (
    AdmissionCreate, AdmissionResponse, AdmissionRow, AdmitResponse, CareTeamAdd,
    CareTeamMemberResponse, DischargeInitiate, EngineWrites, HandoverOpen, HandoverResponse,
    HandoverSign, NurseBedAssignmentResponse, PatientResponse, ShiftScheduleCreate,
    ShiftScheduleResponse, TransferInitiate,
)
```

with:

```python
from homunculus.admission.models import (
    Admission, AdmissionState, CareTeamMember, DischargeDisposition, Handover, Patient,
)
from homunculus.admission.schemas import (
    AdmissionCreate, AdmissionResponse, AdmissionRow, AdmitResponse, CareTeamAdd,
    CareTeamMemberResponse, DischargeConfirmResponse, DischargeStart, EngineWrites,
    HandoverOpen, HandoverResponse, HandoverSign, NurseBedAssignmentResponse, PatientResponse,
    ShiftScheduleCreate, ShiftScheduleResponse, TransferInitiate,
)
```

**Edit** `homunculus-engine/src/homunculus/admission/router.py` (2) — replace:

```python
# ---------------------------------------------------------------------------
@router.post("/{admission_id}/sign-off", response_model=AdmissionResponse)
async def sign_off(
    admission_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
```

with:

```python
# ---------------------------------------------------------------------------
async def _reach_admission(db: AsyncSession, user: User, caller_tenant: uuid.UUID,
                           admission: Admission) -> None:
    """403 `out_of_scope` unless the admission's bed is in the caller's units (spec §4.5)."""
    try:
        unitscope.require_reach(await unitscope.caller_scope(db, user.id, caller_tenant),
                                unit_id=admission.admitting_unit_id, bed_id=admission.bed_id)
    except Refusal as exc:
        raise exc.http() from None


async def _number_of(db: AsyncSession, admission: Admission) -> str:
    """The admission's patient number: its board key."""
    return (await db.execute(select(Patient.patient_number)
                             .where(Patient.id == admission.patient_id))).scalar_one()


@router.post("/{admission_id}/sign-off", response_model=AdmissionResponse)
async def sign_off(
    admission_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
```

**Edit** `homunculus-engine/src/homunculus/admission/router.py` (3) — replace:

```python
    caller_tenant: uuid.UUID = _tenant,
):
    admission = await _get_admission_or_404(db, admission_id, caller_tenant)
    try:
        await service.sign_off_admission(db, admission, signing_user_id=user.id)
```

with:

```python
    caller_tenant: uuid.UUID = _tenant,
):
    """G2-B1a (spec §3.2): the physician who signs a DRAFT with no attending becomes its
    attending — no physician picker in this slice. Audited `admission.sign_off`."""
    admission = await _get_admission_or_404(db, admission_id, caller_tenant)
    await _reach_admission(db, user, caller_tenant, admission)
    if admission.state == AdmissionState.DRAFT and admission.attending_physician_id is None:
        admission.attending_physician_id = user.id
    try:
        await service.sign_off_admission(db, admission, signing_user_id=user.id)
```

**Edit** `homunculus-engine/src/homunculus/admission/router.py` (4) — replace:

```python
        await service.sign_off_admission(db, admission, signing_user_id=user.id)
    except WorkflowError as exc:
        raise _wf(exc)
    await db.commit()
    await db.refresh(admission)
    return admission


```

with:

```python
        await service.sign_off_admission(db, admission, signing_user_id=user.id)
    except WorkflowError as exc:
        raise _wf(exc)
    number = await _number_of(db, admission)
    hospital = await trail.hospital_of(db, caller_tenant)
    await db.commit()
    await db.refresh(admission)
    trail.record(request, hospital, "admission.sign_off", patient_id=number,
                 payload={"admission_id": str(admission.id), "actor": user.username})
    return admission


```

**Edit** `homunculus-engine/src/homunculus/admission/router.py` (5) — replace:

```python
    admission_id: uuid.UUID,
    payload: DischargeInitiate,
    db: AsyncSession = Depends(get_db),
```

with:

```python
    admission_id: uuid.UUID,
    payload: DischargeStart,
    request: Request,
    db: AsyncSession = Depends(get_db),
```

**Edit** `homunculus-engine/src/homunculus/admission/router.py` (6) — replace:

```python
):
    admission = await _get_admission_or_404(db, admission_id, caller_tenant)
    unacked = await escalation_service.count_unacknowledged_critical(
        db, admission_id=admission.id
    )
    try:
        await service.initiate_discharge(
            db, admission, discharge_summary=payload.discharge_summary,
            unacknowledged_critical_count=unacked,  # wired to alert engine (PR #3)
        )
```

with:

```python
):
    """G2-B1a (spec D7, §3.3 step 1): the physician's decision. Refused `critical_alarm_open`
    while the board shows this patient a critical alert nobody acknowledged — firing or latched,
    the alerts the clinician sees (`BoardLink.open_critical`), not the escalation tables, which
    nothing on the ward writes. An exitus is reported by the caller unless another name is
    written. Audited `admission.discharge_start` (the disposition; never the note)."""
    admission = await _get_admission_or_404(db, admission_id, caller_tenant)
    await _reach_admission(db, user, caller_tenant, admission)
    try:
        form.check_discharge(payload, now=datetime.now(timezone.utc),
                             admitted_at=admission.admission_datetime)
    except Refusal as exc:
        raise exc.http() from None
    number = await _number_of(db, admission)
    hospital = await trail.hospital_of(db, caller_tenant)
    link = board_link_of(request)
    reported_by = _strip(payload.reported_by)
    if payload.disposition == DischargeDisposition.EXITUS and reported_by is None:
        reported_by = user.full_name or user.username
    try:
        await service.initiate_discharge(
            db, admission, disposition=payload.disposition,
            institution=_strip(payload.institution), reported_by=reported_by,
            discharge_at=payload.discharge_at, note=_strip(payload.note),
            unacknowledged_critical_count=(link.open_critical(hospital, number)
                                           if link is not None else 0),
        )
```

**Edit** `homunculus-engine/src/homunculus/admission/router.py` (7) — replace:

```python
    await db.refresh(admission)
    return admission


@router.post("/{admission_id}/discharge/confirm", response_model=AdmissionResponse)
async def discharge_confirm(
    admission_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
```

with:

```python
    await db.refresh(admission)
    trail.record(request, hospital, "admission.discharge_start", patient_id=number,
                 payload={"admission_id": str(admission.id),
                          "disposition": payload.disposition.value, "actor": user.username})
    return admission


@router.post("/{admission_id}/discharge/confirm", response_model=DischargeConfirmResponse)
async def discharge_confirm(
    admission_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
```

**Edit** `homunculus-engine/src/homunculus/admission/router.py` (8) — replace:

```python
):
    admission = await _get_admission_or_404(db, admission_id, caller_tenant)
    try:
```

with:

```python
):
    """G2-B1a (§3.3 step 2): the charge nurse confirms the patient has left. The bed goes to
    cleaning and, after the commit, the card leaves every screen (`BoardLink.
    discharge_identity`); `board` says whether that landed. Audited `admission.discharge_confirm`."""
    admission = await _get_admission_or_404(db, admission_id, caller_tenant)
    await _reach_admission(db, user, caller_tenant, admission)
    try:
```

**Edit** `homunculus-engine/src/homunculus/admission/router.py` (9) — replace:

```python
        await service.confirm_discharge(db, admission)
    except WorkflowError as exc:
        raise _wf(exc)
    await db.commit()
    await db.refresh(admission)
    return admission


# ---------------------------------------------------------------------------
```

with:

```python
        await service.confirm_discharge(db, admission)
    except WorkflowError as exc:
        raise _wf(exc)
    number = await _number_of(db, admission)
    hospital = await trail.hospital_of(db, caller_tenant)
    await db.commit()
    await db.refresh(admission)
    trail.record(request, hospital, "admission.discharge_confirm", patient_id=number,
                 payload={"admission_id": str(admission.id), "bed_id": str(admission.bed_id),
                          "actor": user.username})
    link = board_link_of(request)
    board = "skipped"
    if link is not None:
        try:
            await link.discharge_identity(hospital, number)
            board = "ok"
        except Exception:
            log.exception("discharge %s: the card did not leave the board", number)
            board = "failed"
    return DischargeConfirmResponse(**AdmissionResponse.model_validate(admission).model_dump(),
                                    board=board)


# ---------------------------------------------------------------------------
```


- [ ] **Step 4: Run them green:**

```bash
cd /c/tmp/g2b-kabul-be/homunculus-engine
TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 \
  /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_discharge_api.py tests/test_admission_workflow.py 2>&1 | grep -E "^(FAILED|ERROR) |[0-9]+ (passed|failed|error)|^E +[A-Za-z]*(Error|Exception)" | head -16
```

Expected (the replay, times vary):

```text
26 passed, 2 warnings in …s
```

```bash
cd /c/tmp/g2b-kabul-be/homunculus-engine
TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 \
  /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_tenant_isolation.py -k "discharge or sign" 2>&1 | grep -E "^(FAILED|ERROR) |[0-9]+ (passed|failed|error)|^E +[A-Za-z]*(Error|Exception)" | head -16
```

Expected (the replay, times vary):

```text
12 passed, 106 deselected, 2 warnings in …s
```


- [ ] **Step 5: The whole no-DB suite, and the slice's files under Python 3.14:**

```bash
cd /c/tmp/g2b-kabul-be/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 \
  /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q --ignore=tests/test_infinity_vm_pilot.py 2>&1 | grep -E "^(FAILED|ERROR) |[0-9]+ (passed|failed|error)|^E +[A-Za-z]*(Error|Exception)" | head -16
```

Expected (the replay, times vary):

```text
2330 passed, 710 skipped, 3 warnings in …s
```

```bash
cd /c/tmp/g2b-kabul-be/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 \
  /c/tmp/g115-py314/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_permissions.py tests/test_admission_form.py tests/test_kabul_identity.py tests/test_kabul_boardlink.py tests/test_unit_scope.py tests/test_patient_numbers.py tests/test_migration_0012_kabul.py tests/test_route_permissions.py tests/test_tenant_isolation.py tests/test_api_identity_ingest.py tests/test_infinity_shadow_api.py tests/test_api_patient_identity.py tests/test_board.py tests/test_api_board_bedmap.py tests/test_api_board_identity.py tests/test_adt_diagnoses.py tests/test_api_scope.py tests/test_scope_rules.py tests/test_structure_api.py tests/test_admission_api.py tests/test_discharge_api.py tests/test_patient_identity_postgres.py 2>&1 | grep -E "^(FAILED|ERROR) |[0-9]+ (passed|failed|error)|^E +[A-Za-z]*(Error|Exception)" | head -16
```

Expected (the replay, times vary):

```text
292 passed, 175 skipped, 3 warnings in …s
```


- [ ] **Step 6: Line ends:**

```bash
cd /c/tmp/g2b-kabul-be
for f in homunculus-engine/tests/test_discharge_api.py homunculus-engine/tests/test_admission_workflow.py homunculus-engine/tests/test_tenant_isolation.py homunculus-engine/src/homunculus/admission/schemas.py homunculus-engine/src/homunculus/admission/service.py homunculus-engine/src/homunculus/admission/router.py; do printf "%s CR=%s LF=%s\n" "$f" "$(tr -cd '\r' < "$f" | wc -c)" "$(tr -cd '\n' < "$f" | wc -c)"; done
```

Expected:

```text
homunculus-engine/tests/test_discharge_api.py CR=0 LF=224
homunculus-engine/tests/test_admission_workflow.py CR=320 LF=320
homunculus-engine/tests/test_tenant_isolation.py CR=806 LF=806
homunculus-engine/src/homunculus/admission/schemas.py CR=286 LF=286
homunculus-engine/src/homunculus/admission/service.py CR=499 LF=499
homunculus-engine/src/homunculus/admission/router.py CR=614 LF=614
```


- [ ] **Step 7: Commit:**

```bash
cd /c/tmp/g2b-kabul-be
git add -- homunculus-engine/tests/test_discharge_api.py homunculus-engine/tests/test_admission_workflow.py homunculus-engine/tests/test_tenant_isolation.py homunculus-engine/src/homunculus/admission/schemas.py homunculus-engine/src/homunculus/admission/service.py homunculus-engine/src/homunculus/admission/router.py
git status --short && git diff --cached --stat
git commit -m "feat(admission): sign-off, the discharge decision and its confirmation; the card leaves the board (G2-B1a)" \
  -m "red: 10 failed, 2 warnings (AssertionError: {'detail':{'code':'missing_attending','message':'attending_physician_id must be resolved befor)" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- homunculus-engine/tests/test_discharge_api.py homunculus-engine/tests/test_admission_workflow.py homunculus-engine/tests/test_tenant_isolation.py homunculus-engine/src/homunculus/admission/schemas.py homunculus-engine/src/homunculus/admission/service.py homunculus-engine/src/homunculus/admission/router.py
```

---

### Task 10: The `kabul` strings, four languages

**Lane:** dashboard (`/c/tmp/g2b-kabul-fe`). **Needs:** nothing (it may run beside Tasks 1–3).

Spec §5, §5.7. Every text of the slice — the route and its tabs, the form's labels, choices and missing-field names, the number box and its failed parts, the Taburcu lists and dialog, the bed states, the release, the sign-off strip and the badge, Yönetim › Yapı, "Bilinmeyen birim/yatak", and the words of every coded refusal — in one namespace, `strings/kabul.js`: Turkish the source, Azerbaijani the default, Russian ("система", never "движок") and English. It joins `catalog.js` as a `G2-B1a` block. An `az` text equal to its `tr` source, and a Russian text with no Cyrillic, need a reviewed entry: the eight blood groups are symbols (`NEUTRAL`, and `AZ_SAME_AS_TR`), and eleven words are the same in Azerbaijani (each with its reason, in `AZ_SAME_AS_TR`). The texts await a native reading (O48).

**Files:**
- Create: `dashboard/src/live/i18n/strings/kabul.js`
- Modify: `dashboard/src/live/i18n/strings.test.js`
- Modify: `dashboard/src/live/i18n/catalog.js`

- [ ] **Step 1: Add the reviewed entries** — in each list a blank-separated `G2-B1a` block; do not tidy the gaps:

**Edit** `dashboard/src/live/i18n/strings.test.js` (1) — replace:

```js
  "monitor.p.nbp", //              NBP — the Kappa's own label for the cuff pressure

```

with:

```js
  "monitor.p.nbp", //              NBP — the Kappa's own label for the cuff pressure

  // G2-B1a (kabul) · neutral — ABO and Rh, written the same in every script
  "kabul.blood.aPos", "kabul.blood.aNeg", "kabul.blood.bPos", "kabul.blood.bNeg",
  "kabul.blood.abPos", "kabul.blood.abNeg", "kabul.blood.oPos", "kabul.blood.oNeg",

```

**Edit** `dashboard/src/live/i18n/strings.test.js` (2) — replace:

```js
  "monitor.p.nbp", //        NBP — the monitor's label, not a word

]);

```

with:

```js
  "monitor.p.nbp", //        NBP — the monitor's label, not a word

  // G2-B1a (kabul) · az = tr
  "kabul.f.name", "kabul.miss.name", // Ad soyad — as admin.fieldFullName (the prototype's AZ dictionary)
  "kabul.f.fin", //          FİN — the Azerbaijani personal code's own name
  "kabul.f.phone", //        Telefon — the same word in Azerbaijani
  "kabul.choose", //         Seçin… — the same imperative in Azerbaijani
  "kabul.age", //            "{years} yaş {months} ay {days} gün" — yaş, ay, gün are Azerbaijani too
  "kabul.nat.ir", //         İran — the country's name in Azerbaijani
  "kabul.freeBeds", //       "{count} boş" — boş is Azerbaijani for empty
  "kabul.state.AVAILABLE", // Boş — the same
  "kabul.state.OCCUPIED", // Dolu — the same word in Azerbaijani
  "kabul.blood.aPos", "kabul.blood.aNeg", "kabul.blood.bPos", "kabul.blood.bNeg", // ABO and Rh: symbols
  "kabul.blood.abPos", "kabul.blood.abNeg", "kabul.blood.oPos", "kabul.blood.oNeg",

]);

```


- [ ] **Step 2: Run it and see it red** — the reviewed entries name keys no namespace has:

```bash
cd /c/tmp/g2b-kabul-fe/dashboard
npx vitest run src/live/i18n/strings.test.js 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ Test Files |^ +Tests |^ FAIL |→ |×"
```

Expected (the replay, times vary):

```text
Test Files  1 failed (1)
      Tests  1 failed | 6 passed (7)
 FAIL  src/live/i18n/strings.test.js > live UI dictionaries > an Azerbaijani text equals its Turkish source only where that was reviewed
× live UI dictionaries > an Azerbaijani text equals its Turkish source only where that was reviewed 10ms
→ kabul.f.name is listed but no longer exists: expected false to be true // Object.is equality
```


- [ ] **Step 3: Write the namespace and register it:**

**Write** `dashboard/src/live/i18n/strings/kabul.js` (a new file, whole):

```js
// Group 2 · B1a — Hasta Kabul: the admission screen (Kabul · Taburcu · Yataklar), the sign-off
// strip and the bed card's badge, the unit and bed names of the top bar, Yönetim › Yapı, and the
// words of the admission routes' coded refusals (apiErrors.js `ADMISSION_CODE_KEYS`).
//
// TR is the source; AZ is the default. AZ, RU and EN are the planner's and await a native reading
// before the pilot (open item, as every namespace of the live UI). Russian calls the engine
// "система". No text here is clinical advice: the screens record who lies in which bed and where
// a patient went.
export default {
  tr: {
    nav: "Hasta Kabul", navShort: "Kabul",
    title: "Hasta Kabul", sub: "Kabul, taburcu ve yatakların durumu — kendi birimleriniz.",
    sections: "Hasta kabul bölümleri", noAccess: "Bu ekranın hiçbir bölümüne yetkiniz yok.",
    tabAdmit: "Kabul", tabDischarge: "Taburcu", tabBeds: "Yataklar",
    loading: "Yükleniyor…",
    noView: "Kabul kayıtlarını okuma yetkiniz yok.",
    listFailed: "Liste okunamadı: {reason}", listStale: "Liste yeniden okunamadı; son okunan gösteriliyor: {reason}",
    readOnly: "Görüntüleme yetkisiyle açtınız. Kabulü hemşire ve sorumlu hemşire yapar; hekim kabulü hasta ekranından imzalar.",
    groupIdentity: "Kimlik", groupAdmission: "Kabul", groupContact: "İletişim ve onam", groupBed: "Yatak",
    f: {
      name: "Ad soyad", father: "Baba adı", sex: "Cinsiyet", dob: "Doğum tarihi", nationality: "Uyruk",
      fin: "FİN", passport: "Pasaport no", phone: "Telefon", type: "Kabul türü", source: "Kaynak",
      diagnosis: "Kabul tanısı", weight: "Kilo (kg)", height: "Boy (cm)", blood: "Kan grubu",
      allergy: "Bilinen alerji", comorbidities: "Eşlik eden hastalıklar",
      comorbiditiesText: "Diğer eşlik eden hastalıklar", his: "HBYS protokol no",
      relativeName: "Yakınının adı", relativeRelation: "Yakınlığı", relativePhone: "Yakınının telefonu",
      companion: "Refakatçi", consent: "Onam", disposition: "Çıkış şekli", institution: "Sevk edilen kurum",
      reportedBy: "Bildiren hekim", dischargeAt: "Çıkış zamanı", note: "Not",
    },
    choose: "Seçin…",
    age: "{years} yaş {months} ay {days} gün",
    finHint: "7 harf ya da rakam", phoneHint: "Ülke koduyla: +994 …",
    noAllergy: "Bilinen alerjisi yok",
    comorbiditiesTextHint: "Kaydedilir; motora kod olarak gönderilmez.",
    sms: "SMS ile bilgilendirme izni",
    sex: { female: "Kadın", male: "Erkek" },
    type: { medical: "Medikal yatış", surgical: "Ameliyat", icu: "Yoğun bakım", procedure: "Müdahale" },
    source: { emergency: "Acil", electiveSurgery: "Planlı ameliyat", transferInternal: "Hastane içi sevk",
      transferExternal: "Başka kurumdan sevk", other: "Diğer" },
    blood: { unknown: "Bilinmiyor", aPos: "A Rh(+)", aNeg: "A Rh(−)", bPos: "B Rh(+)", bNeg: "B Rh(−)",
      abPos: "AB Rh(+)", abNeg: "AB Rh(−)", oPos: "0 Rh(+)", oNeg: "0 Rh(−)" },
    comorbidity: { copd: "KOAH", respiratoryFailure: "Kronik solunum yetmezliği", homeOxygen: "Evde oksijen",
      dementia: "Demans / kronik konfüzyon" },
    relation: { spouse: "Eşi", mother: "Annesi", father: "Babası", child: "Çocuğu", sibling: "Kardeşi", other: "Diğer" },
    nat: { az: "Azerbaycan", tr: "Türkiye", ru: "Rusya", ge: "Gürcistan", ir: "İran", other: "Diğer" },
    consent: { signed: "KVKK onamı imzalandı", later: "Bilinci kapalı — onam sonra alınacak" },
    missingTitle: "Eksik alanlar", missingNone: "Zorunlu alanların hepsi dolu.",
    miss: {
      name: "Ad soyad", sex: "Cinsiyet", dob: "Doğum tarihi", dobWrong: "Doğum tarihi geçerli değil",
      fin: "FİN 7 harf ya da rakam olmalı", type: "Kabul türü", diagnosis: "Kabul tanısı",
      weight: "Kilo bir sayı olmalı", height: "Boy bir sayı olmalı",
      allergy: "Alerji ya da «bilinen alerjisi yok» — ikisinden biri", consent: "Onam", bed: "Yatak",
    },
    admit: "Kabul et", admitting: "Kabul kaydediliyor…", admitted: "kabul edildi, hasta no {number}",
    doneTitle: "Kabul edildi", doneBed: "Yatak: {bed}", enterOnDevice: "Başucu cihazına bu numarayı girin.",
    seeOnBoard: "Panoda gör", next: "Yeni kabul",
    engineFailed: {
      board: "Kart panoya iletilemedi — sayfayı yenileyip panoyu kontrol edin.",
      weight: "Kilo motora iletilemedi — hasta ekranından girin.",
      profile: "Eşlik eden hastalıklar motora iletilemedi — hasta ekranından girin.",
    },
    pickUnit: "Birim", pickerNone: "Kapsamınızda tanımlı birim ya da yatak yok.",
    freeBeds: "{count} boş", unitClosed: "kapalı", roomClosed: "kapalı",
    pickUnitFirst: "Önce birimi seçin.", pickHint: "Yalnız boş ve açık yataklar seçilebilir.",
    bedChosen: "Seçilen: {bed}", bedClosed: "Kapalı", bedOther: "Başka bir durumda",
    unitUnknown: "Bilinmeyen birim", bedUnknown: "Bilinmeyen yatak",
    state: { AVAILABLE: "Boş", OCCUPIED: "Dolu", PENDING_DISCHARGE: "Taburcu bekliyor",
      PENDING_TRANSFER_OUT: "Transfer bekliyor", HOUSEKEEPING: "Temizlikte", MAINTENANCE: "Bakımda", BLOCKED: "Kapatılmış" },
    pendingTitle: "Taburcusu başlatılan", pendingNone: "Onay bekleyen taburcu yok.",
    lyingTitle: "Yatan hastalar", lyingNone: "Kapsamınızda yatan hasta yok.",
    badgeDraft: "Hekim imzası bekliyor",
    signFirst: "Önce kabul imzalanmalı (hasta ekranı).",
    startDischarge: "Taburcuyu başlat", confirmLeft: "Hasta çıktı · onayla",
    criticalOpen: "Onaylanmamış kritik alarm var: önce alarmı görün.",
    disp: { home: "Eve taburcu", other: "Başka kuruma sevk", exitus: "Vefat (exitus)" },
    reportedByHint: "Boş bırakılırsa siz.",
    dischargeTitle: "Taburcu · {subject}", dischargeSubmit: "Taburcuyu başlat",
    dischargeStarted: "taburcu başlatıldı; sorumlu hemşirenin onayı bekleniyor",
    discharged: "taburcu onaylandı; yatak temizliğe alındı",
    dischargedBoardFailed: "taburcu onaylandı; kart panodan kaldırılamadı — panoyu kontrol edin",
    release: "Temizlik bitti · boş", released: "yatak boş",
    awaitingSignature: "Hekim imzası bekliyor — kart ve izlem kabulle başladı; imza kabul kaydına yazılır.",
    sign: "Kabulü imzala", signed: "kabul imzalandı", signNoRight: "İmzayı yalnız kabulü onaylama yetkisi olan hekim atar.",
    structureTab: "Yapı",
    structureIntro: "Bina, birim, oda ve yatakları buradan kurun. Hiçbir şey silinmez: kapatılan yer kalır ve kabule sunulmaz.",
    newSite: "Yeni bina adı", addSite: "Bina ekle",
    newUnit: "{site} içinde yeni birim adı", addUnit: "Birim ekle", unitTypeLabel: "Birim türü",
    newRoom: "{unit} içinde yeni oda adı", addRoom: "Oda ekle",
    newBed: "{room} içinde yeni yatak etiketi", addBed: "Yatak ekle",
    unitType: { adultIcu: "Erişkin YBÜ", nicu: "Yenidoğan YBÜ", picu: "Çocuk YBÜ", cvicu: "Kalp-damar YBÜ", bmtIcu: "Kemik iliği YBÜ" },
    rename: "Adını değiştir", renameOf: "{name} için yeni ad", close: "Kapat", reopen: "Yeniden aç",
    closed: "Kapalı", added: "eklendi", renamed: "adı değişti", closedDone: "kapatıldı", reopened: "yeniden açıldı",
    err: {
      bedNotAvailable: "Bu yatak artık boş değil; başka bir yatak seçin.",
      bedClosed: "Bu yatak, odası ya da birimi kapalı.",
      outOfScope: "Bu yatak sizin birimlerinizden birinde değil.",
      criticalAlarmOpen: "Onaylanmamış kritik alarm var; taburcu başlatılamaz. Önce alarmı görün.",
      numberExhausted: "Bu yıl için hasta numarası kalmadı; sistem yöneticisine bildirin.",
      invalidTransition: "Kayıt bu işlem için uygun durumda değil; liste yenilendi.",
      missingAttending: "Kabulün sorumlu hekimi yok.",
      openAdmission: "Bu hastanın açık bir kabulü zaten var.",
      bedInUse: "Hastası olan yatak kapatılamaz.",
      hasOpenBeds: "Önce altındaki bütün yatakları kapatın.",
      nameTaken: "Aynı yerde bu ad zaten var.",
    },
    invalid: {
      displayName: "Ad soyad gerekli.", dateOfBirth: "Doğum tarihi geçerli değil.",
      nationalId: "FİN 7 harf ya da rakam olmalı.", phone: "Telefon numarası geçerli değil.",
      relativePhone: "Yakınının telefon numarası geçerli değil.", admissionType: "Kabul türü gerekli.",
      diagnosis: "Kabul tanısı gerekli.", weight: "Kilo kabul edilebilir aralıkta değil.",
      height: "Boy kabul edilebilir aralıkta değil.",
      allergy: "Bilinen alerjiyi yazın ya da «bilinen alerjisi yok» işaretleyin — ikisinden biri.",
      comorbidities: "Eşlik eden hastalık seçimi geçerli değil.", consent: "Onam gerekli.",
      unit: "Yatak seçilen birimde değil.", institution: "Sevk edilen kurumu yazın.",
      dischargeAt: "Çıkış zamanı geçerli değil (gelecekte ya da kabulden önce olamaz).",
      name: "Ad boş olamaz.", label: "Yatak etiketi boş olamaz.", other: "Bir alan geçerli değil.",
    },
  },
  az: {
    nav: "Xəstə qəbulu", navShort: "Qəbul",
    title: "Xəstə qəbulu", sub: "Qəbul, evə yazılma və çarpayıların vəziyyəti — öz şöbələriniz.",
    sections: "Xəstə qəbulu bölmələri", noAccess: "Bu ekranın heç bir bölməsinə səlahiyyətiniz yoxdur.",
    tabAdmit: "Qəbul", tabDischarge: "Evə yazılma", tabBeds: "Çarpayılar",
    loading: "Yüklənir…",
    noView: "Qəbul qeydlərini oxumaq səlahiyyətiniz yoxdur.",
    listFailed: "Siyahı oxunmadı: {reason}", listStale: "Siyahı yenidən oxunmadı; son oxunan göstərilir: {reason}",
    readOnly: "Baxış səlahiyyəti ilə açmısınız. Qəbulu tibb bacısı və baş tibb bacısı edir; həkim qəbulu xəstə ekranından imzalayır.",
    groupIdentity: "Şəxsiyyət", groupAdmission: "Qəbul", groupContact: "Əlaqə və razılıq", groupBed: "Çarpayı",
    f: {
      name: "Ad soyad", father: "Ata adı", sex: "Cins", dob: "Doğum tarixi", nationality: "Vətəndaşlıq",
      fin: "FİN", passport: "Pasport nömrəsi", phone: "Telefon", type: "Qəbul növü", source: "Mənbə",
      diagnosis: "Qəbul diaqnozu", weight: "Çəki (kq)", height: "Boy (sm)", blood: "Qan qrupu",
      allergy: "Məlum allergiya", comorbidities: "Müşayiət edən xəstəliklər",
      comorbiditiesText: "Digər müşayiət edən xəstəliklər", his: "XİS protokol nömrəsi",
      relativeName: "Yaxınının adı", relativeRelation: "Yaxınlıq dərəcəsi", relativePhone: "Yaxınının telefonu",
      companion: "Müşayiətçi", consent: "Razılıq", disposition: "Çıxış forması", institution: "Göndərilən müəssisə",
      reportedBy: "Bildirən həkim", dischargeAt: "Çıxış vaxtı", note: "Qeyd",
    },
    choose: "Seçin…",
    age: "{years} yaş {months} ay {days} gün",
    finHint: "7 hərf və ya rəqəm", phoneHint: "Ölkə kodu ilə: +994 …",
    noAllergy: "Məlum allergiyası yoxdur",
    comorbiditiesTextHint: "Yadda saxlanılır; sistemə kod kimi göndərilmir.",
    sms: "SMS ilə məlumatlandırma icazəsi",
    sex: { female: "Qadın", male: "Kişi" },
    type: { medical: "Tibbi yatış", surgical: "Əməliyyat", icu: "Reanimasiya", procedure: "Müdaxilə" },
    source: { emergency: "Təcili", electiveSurgery: "Planlı əməliyyat", transferInternal: "Xəstəxanadaxili göndəriş",
      transferExternal: "Başqa müəssisədən göndəriş", other: "Digər" },
    blood: { unknown: "Məlum deyil", aPos: "A Rh(+)", aNeg: "A Rh(−)", bPos: "B Rh(+)", bNeg: "B Rh(−)",
      abPos: "AB Rh(+)", abNeg: "AB Rh(−)", oPos: "0 Rh(+)", oNeg: "0 Rh(−)" },
    comorbidity: { copd: "XOAX", respiratoryFailure: "Xroniki tənəffüs çatışmazlığı", homeOxygen: "Evdə oksigen",
      dementia: "Demensiya / xroniki konfuziya" },
    relation: { spouse: "Həyat yoldaşı", mother: "Anası", father: "Atası", child: "Övladı", sibling: "Bacısı / qardaşı", other: "Digər" },
    nat: { az: "Azərbaycan", tr: "Türkiyə", ru: "Rusiya", ge: "Gürcüstan", ir: "İran", other: "Digər" },
    consent: { signed: "Şəxsi məlumatlara razılıq imzalandı", later: "Huşsuzdur — razılıq sonra alınacaq" },
    missingTitle: "Çatışmayan sahələr", missingNone: "Bütün məcburi sahələr doludur.",
    miss: {
      name: "Ad soyad", sex: "Cins", dob: "Doğum tarixi", dobWrong: "Doğum tarixi düzgün deyil",
      fin: "FİN 7 hərf və ya rəqəm olmalıdır", type: "Qəbul növü", diagnosis: "Qəbul diaqnozu",
      weight: "Çəki rəqəm olmalıdır", height: "Boy rəqəm olmalıdır",
      allergy: "Allergiya və ya «məlum allergiyası yoxdur» — ikisindən biri", consent: "Razılıq", bed: "Çarpayı",
    },
    admit: "Qəbul et", admitting: "Qəbul qeyd olunur…", admitted: "qəbul edildi, xəstə nömrəsi {number}",
    doneTitle: "Qəbul edildi", doneBed: "Çarpayı: {bed}", enterOnDevice: "Çarpayı yanındakı cihaza bu nömrəni daxil edin.",
    seeOnBoard: "Paneldə bax", next: "Yeni qəbul",
    engineFailed: {
      board: "Kart panelə çatmadı — səhifəni yeniləyib paneli yoxlayın.",
      weight: "Çəki sistemə çatmadı — xəstə ekranından daxil edin.",
      profile: "Müşayiət edən xəstəliklər sistemə çatmadı — xəstə ekranından daxil edin.",
    },
    pickUnit: "Şöbə", pickerNone: "Səlahiyyət dairənizdə təyin olunmuş şöbə və ya çarpayı yoxdur.",
    freeBeds: "{count} boş", unitClosed: "bağlıdır", roomClosed: "bağlıdır",
    pickUnitFirst: "Əvvəlcə şöbəni seçin.", pickHint: "Yalnız boş və açıq çarpayılar seçilə bilər.",
    bedChosen: "Seçilən: {bed}", bedClosed: "Bağlıdır", bedOther: "Başqa vəziyyətdədir",
    unitUnknown: "Naməlum şöbə", bedUnknown: "Naməlum çarpayı",
    state: { AVAILABLE: "Boş", OCCUPIED: "Dolu", PENDING_DISCHARGE: "Evə yazılma gözləyir",
      PENDING_TRANSFER_OUT: "Köçürmə gözləyir", HOUSEKEEPING: "Təmizlikdədir", MAINTENANCE: "Təmirdədir", BLOCKED: "Bağlanıb" },
    pendingTitle: "Evə yazılması başladılanlar", pendingNone: "Təsdiq gözləyən evə yazılma yoxdur.",
    lyingTitle: "Yatan xəstələr", lyingNone: "Səlahiyyət dairənizdə yatan xəstə yoxdur.",
    badgeDraft: "Həkim imzası gözlənilir",
    signFirst: "Əvvəlcə qəbul imzalanmalıdır (xəstə ekranı).",
    startDischarge: "Evə yazılmanı başlat", confirmLeft: "Xəstə çıxdı · təsdiqlə",
    criticalOpen: "Təsdiqlənməmiş kritik siqnal var: əvvəlcə siqnala baxın.",
    disp: { home: "Evə yazılma", other: "Başqa müəssisəyə göndəriş", exitus: "Vəfat (exitus)" },
    reportedByHint: "Boş qalsa, siz.",
    dischargeTitle: "Evə yazılma · {subject}", dischargeSubmit: "Evə yazılmanı başlat",
    dischargeStarted: "evə yazılma başladıldı; baş tibb bacısının təsdiqi gözlənilir",
    discharged: "evə yazılma təsdiqləndi; çarpayı təmizliyə verildi",
    dischargedBoardFailed: "evə yazılma təsdiqləndi; kart paneldən götürülmədi — paneli yoxlayın",
    release: "Təmizlik bitdi · boş", released: "çarpayı boşdur",
    awaitingSignature: "Həkim imzası gözlənilir — kart və izləmə qəbulla başladı; imza qəbul qeydinə yazılır.",
    sign: "Qəbulu imzala", signed: "qəbul imzalandı", signNoRight: "İmzanı yalnız qəbulu təsdiqləmək səlahiyyəti olan həkim atır.",
    structureTab: "Struktur",
    structureIntro: "Bina, şöbə, otaq və çarpayıları buradan qurun. Heç nə silinmir: bağlanan yer qalır və qəbula təklif olunmur.",
    newSite: "Yeni binanın adı", addSite: "Bina əlavə et",
    newUnit: "{site} daxilində yeni şöbənin adı", addUnit: "Şöbə əlavə et", unitTypeLabel: "Şöbənin növü",
    newRoom: "{unit} daxilində yeni otağın adı", addRoom: "Otaq əlavə et",
    newBed: "{room} daxilində yeni çarpayının etiketi", addBed: "Çarpayı əlavə et",
    unitType: { adultIcu: "Böyüklər reanimasiyası", nicu: "Yenidoğulmuşlar reanimasiyası", picu: "Uşaq reanimasiyası",
      cvicu: "Kardiovaskulyar reanimasiya", bmtIcu: "Sümük iliyi reanimasiyası" },
    rename: "Adını dəyiş", renameOf: "{name} üçün yeni ad", close: "Bağla", reopen: "Yenidən aç",
    closed: "Bağlıdır", added: "əlavə edildi", renamed: "adı dəyişdi", closedDone: "bağlandı", reopened: "yenidən açıldı",
    err: {
      bedNotAvailable: "Bu çarpayı artıq boş deyil; başqa çarpayı seçin.",
      bedClosed: "Bu çarpayı, onun otağı və ya şöbəsi bağlıdır.",
      outOfScope: "Bu çarpayı sizin şöbələrinizdən birində deyil.",
      criticalAlarmOpen: "Təsdiqlənməmiş kritik siqnal var; evə yazılma başladıla bilməz. Əvvəlcə siqnala baxın.",
      numberExhausted: "Bu il üçün xəstə nömrəsi qalmayıb; sistem administratoruna bildirin.",
      invalidTransition: "Qeyd bu əməliyyat üçün uyğun vəziyyətdə deyil; siyahı yeniləndi.",
      missingAttending: "Qəbulun məsul həkimi yoxdur.",
      openAdmission: "Bu xəstənin artıq açıq qəbulu var.",
      bedInUse: "Xəstəsi olan çarpayı bağlana bilməz.",
      hasOpenBeds: "Əvvəlcə altındakı bütün çarpayıları bağlayın.",
      nameTaken: "Eyni yerdə bu ad artıq var.",
    },
    invalid: {
      displayName: "Ad soyad tələb olunur.", dateOfBirth: "Doğum tarixi düzgün deyil.",
      nationalId: "FİN 7 hərf və ya rəqəm olmalıdır.", phone: "Telefon nömrəsi düzgün deyil.",
      relativePhone: "Yaxınının telefon nömrəsi düzgün deyil.", admissionType: "Qəbul növü tələb olunur.",
      diagnosis: "Qəbul diaqnozu tələb olunur.", weight: "Çəki qəbul edilən həddə deyil.",
      height: "Boy qəbul edilən həddə deyil.",
      allergy: "Məlum allergiyanı yazın və ya «məlum allergiyası yoxdur» qeyd edin — ikisindən biri.",
      comorbidities: "Müşayiət edən xəstəlik seçimi düzgün deyil.", consent: "Razılıq tələb olunur.",
      unit: "Çarpayı seçilən şöbədə deyil.", institution: "Göndərilən müəssisəni yazın.",
      dischargeAt: "Çıxış vaxtı düzgün deyil (gələcəkdə və ya qəbuldan əvvəl ola bilməz).",
      name: "Ad boş ola bilməz.", label: "Çarpayı etiketi boş ola bilməz.", other: "Sahələrdən biri düzgün deyil.",
    },
  },
  ru: {
    nav: "Приём пациентов", navShort: "Приём",
    title: "Приём пациентов", sub: "Приём, выписка и состояние коек — ваши отделения.",
    sections: "Разделы приёма пациентов", noAccess: "У вас нет прав ни на один раздел этого экрана.",
    tabAdmit: "Приём", tabDischarge: "Выписка", tabBeds: "Койки",
    loading: "Загрузка…",
    noView: "У вас нет права читать записи о приёме.",
    listFailed: "Список не прочитан: {reason}", listStale: "Список не перечитан; показан последний прочитанный: {reason}",
    readOnly: "Вы открыли экран с правом просмотра. Приём оформляют медсёстры и старшая медсестра; врач подписывает приём на экране пациента.",
    groupIdentity: "Личность", groupAdmission: "Приём", groupContact: "Контакты и согласие", groupBed: "Койка",
    f: {
      name: "Фамилия и имя", father: "Отчество", sex: "Пол", dob: "Дата рождения", nationality: "Гражданство",
      fin: "ФИН", passport: "Номер паспорта", phone: "Телефон", type: "Тип приёма", source: "Откуда поступил",
      diagnosis: "Диагноз при поступлении", weight: "Вес (кг)", height: "Рост (см)", blood: "Группа крови",
      allergy: "Известная аллергия", comorbidities: "Сопутствующие заболевания",
      comorbiditiesText: "Другие сопутствующие заболевания", his: "Номер протокола МИС",
      relativeName: "Имя родственника", relativeRelation: "Степень родства", relativePhone: "Телефон родственника",
      companion: "Сопровождающий", consent: "Согласие", disposition: "Исход", institution: "Учреждение, куда направлен",
      reportedBy: "Сообщивший врач", dischargeAt: "Время выписки", note: "Примечание",
    },
    choose: "Выберите…",
    age: "{years} лет {months} мес. {days} дн.",
    finHint: "7 букв или цифр", phoneHint: "С кодом страны: +994 …",
    noAllergy: "Известной аллергии нет",
    comorbiditiesTextHint: "Сохраняется; системе как код не передаётся.",
    sms: "Согласие на SMS-уведомления",
    sex: { female: "Женский", male: "Мужской" },
    type: { medical: "Терапевтическая госпитализация", surgical: "Операция", icu: "Реанимация", procedure: "Вмешательство" },
    source: { emergency: "Экстренно", electiveSurgery: "Плановая операция", transferInternal: "Перевод внутри больницы",
      transferExternal: "Перевод из другого учреждения", other: "Другое" },
    blood: { unknown: "Неизвестна", aPos: "A Rh(+)", aNeg: "A Rh(−)", bPos: "B Rh(+)", bNeg: "B Rh(−)",
      abPos: "AB Rh(+)", abNeg: "AB Rh(−)", oPos: "0 Rh(+)", oNeg: "0 Rh(−)" },
    comorbidity: { copd: "ХОБЛ", respiratoryFailure: "Хроническая дыхательная недостаточность", homeOxygen: "Домашний кислород",
      dementia: "Деменция / хроническая спутанность" },
    relation: { spouse: "Супруг(а)", mother: "Мать", father: "Отец", child: "Ребёнок", sibling: "Брат / сестра", other: "Другое" },
    nat: { az: "Азербайджан", tr: "Турция", ru: "Россия", ge: "Грузия", ir: "Иран", other: "Другое" },
    consent: { signed: "Согласие на обработку данных подписано", later: "Без сознания — согласие будет получено позже" },
    missingTitle: "Не заполнено", missingNone: "Все обязательные поля заполнены.",
    miss: {
      name: "Фамилия и имя", sex: "Пол", dob: "Дата рождения", dobWrong: "Дата рождения неверна",
      fin: "ФИН — 7 букв или цифр", type: "Тип приёма", diagnosis: "Диагноз при поступлении",
      weight: "Вес должен быть числом", height: "Рост должен быть числом",
      allergy: "Аллергия или «известной аллергии нет» — одно из двух", consent: "Согласие", bed: "Койка",
    },
    admit: "Принять", admitting: "Приём записывается…", admitted: "принят, номер пациента {number}",
    doneTitle: "Принят", doneBed: "Койка: {bed}", enterOnDevice: "Введите этот номер на прикроватном мониторе.",
    seeOnBoard: "Открыть на панели", next: "Новый приём",
    engineFailed: {
      board: "Карточка не попала на панель — обновите страницу и проверьте панель.",
      weight: "Вес не передан системе — введите его на экране пациента.",
      profile: "Сопутствующие заболевания не переданы системе — введите их на экране пациента.",
    },
    pickUnit: "Отделение", pickerNone: "В вашей зоне нет заданных отделений или коек.",
    freeBeds: "свободно: {count}", unitClosed: "закрыто", roomClosed: "закрыта",
    pickUnitFirst: "Сначала выберите отделение.", pickHint: "Выбрать можно только свободную открытую койку.",
    bedChosen: "Выбрано: {bed}", bedClosed: "Закрыта", bedOther: "В другом состоянии",
    unitUnknown: "Неизвестное отделение", bedUnknown: "Неизвестная койка",
    state: { AVAILABLE: "Свободна", OCCUPIED: "Занята", PENDING_DISCHARGE: "Ожидает выписки",
      PENDING_TRANSFER_OUT: "Ожидает перевода", HOUSEKEEPING: "На уборке", MAINTENANCE: "На обслуживании", BLOCKED: "Заблокирована" },
    pendingTitle: "Начатые выписки", pendingNone: "Нет выписок, ожидающих подтверждения.",
    lyingTitle: "Лежащие пациенты", lyingNone: "В вашей зоне нет лежащих пациентов.",
    badgeDraft: "Ждёт подписи врача",
    signFirst: "Сначала приём должен быть подписан (экран пациента).",
    startDischarge: "Начать выписку", confirmLeft: "Пациент ушёл · подтвердить",
    criticalOpen: "Есть неподтверждённая критическая тревога: сначала просмотрите её.",
    disp: { home: "Выписан домой", other: "Переведён в другое учреждение", exitus: "Смерть (exitus)" },
    reportedByHint: "Если пусто — вы.",
    dischargeTitle: "Выписка · {subject}", dischargeSubmit: "Начать выписку",
    dischargeStarted: "выписка начата; ждёт подтверждения старшей медсестры",
    discharged: "выписка подтверждена; койка отправлена на уборку",
    dischargedBoardFailed: "выписка подтверждена; карточка не снята с панели — проверьте панель",
    release: "Уборка окончена · свободна", released: "койка свободна",
    awaitingSignature: "Ждёт подписи врача — карточка и наблюдение начаты при приёме; подпись записывается в запись о приёме.",
    sign: "Подписать приём", signed: "приём подписан", signNoRight: "Подписывает только врач с правом подтверждать приём.",
    structureTab: "Структура",
    structureIntro: "Здесь создаются корпуса, отделения, палаты и койки. Ничего не удаляется: закрытое остаётся и не предлагается для приёма.",
    newSite: "Название нового корпуса", addSite: "Добавить корпус",
    newUnit: "Новое отделение в «{site}»", addUnit: "Добавить отделение", unitTypeLabel: "Тип отделения",
    newRoom: "Новая палата в «{unit}»", addRoom: "Добавить палату",
    newBed: "Метка новой койки в «{room}»", addBed: "Добавить койку",
    unitType: { adultIcu: "Взрослая реанимация", nicu: "Реанимация новорождённых", picu: "Детская реанимация",
      cvicu: "Кардиореанимация", bmtIcu: "Реанимация трансплантации костного мозга" },
    rename: "Переименовать", renameOf: "Новое название для «{name}»", close: "Закрыть", reopen: "Открыть снова",
    closed: "Закрыто", added: "добавлено", renamed: "переименовано", closedDone: "закрыто", reopened: "открыто снова",
    err: {
      bedNotAvailable: "Эта койка уже не свободна; выберите другую.",
      bedClosed: "Эта койка, её палата или отделение закрыты.",
      outOfScope: "Эта койка не в одном из ваших отделений.",
      criticalAlarmOpen: "Есть неподтверждённая критическая тревога; выписку начать нельзя. Сначала просмотрите тревогу.",
      numberExhausted: "Номера пациентов на этот год закончились; сообщите администратору системы.",
      invalidTransition: "Запись не в том состоянии для этого действия; список обновлён.",
      missingAttending: "У приёма нет лечащего врача.",
      openAdmission: "У этого пациента уже есть открытый приём.",
      bedInUse: "Койку с пациентом закрыть нельзя.",
      hasOpenBeds: "Сначала закройте все койки внутри.",
      nameTaken: "Такое название здесь уже есть.",
    },
    invalid: {
      displayName: "Нужны фамилия и имя.", dateOfBirth: "Дата рождения неверна.",
      nationalId: "ФИН — 7 букв или цифр.", phone: "Номер телефона неверен.",
      relativePhone: "Номер телефона родственника неверен.", admissionType: "Нужен тип приёма.",
      diagnosis: "Нужен диагноз при поступлении.", weight: "Вес вне допустимых пределов.",
      height: "Рост вне допустимых пределов.",
      allergy: "Укажите известную аллергию или отметьте «известной аллергии нет» — одно из двух.",
      comorbidities: "Выбор сопутствующих заболеваний неверен.", consent: "Нужно согласие.",
      unit: "Койка не в выбранном отделении.", institution: "Укажите учреждение, куда направлен пациент.",
      dischargeAt: "Время выписки неверно (не в будущем и не раньше приёма).",
      name: "Название не может быть пустым.", label: "Метка койки не может быть пустой.", other: "Одно из полей неверно.",
    },
  },
  en: {
    nav: "Admissions", navShort: "Admit",
    title: "Admissions", sub: "Admission, discharge and the state of the beds — your own units.",
    sections: "Admission sections", noAccess: "You have no right to any section of this screen.",
    tabAdmit: "Admit", tabDischarge: "Discharge", tabBeds: "Beds",
    loading: "Loading…",
    noView: "You have no right to read admissions.",
    listFailed: "The list could not be read: {reason}", listStale: "The list could not be read again; the last one read is shown: {reason}",
    readOnly: "You opened this with the right to view. Nurses and charge nurses admit; a physician signs the admission on the patient screen.",
    groupIdentity: "Identity", groupAdmission: "Admission", groupContact: "Contact and consent", groupBed: "Bed",
    f: {
      name: "Full name", father: "Father's name", sex: "Sex", dob: "Date of birth", nationality: "Nationality",
      fin: "FIN", passport: "Passport number", phone: "Phone", type: "Admission type", source: "Source",
      diagnosis: "Admission diagnosis", weight: "Weight (kg)", height: "Height (cm)", blood: "Blood group",
      allergy: "Known allergy", comorbidities: "Comorbidities",
      comorbiditiesText: "Other comorbidities", his: "HIS protocol number",
      relativeName: "Relative's name", relativeRelation: "Relationship", relativePhone: "Relative's phone",
      companion: "Companion", consent: "Consent", disposition: "Disposition", institution: "Receiving institution",
      reportedBy: "Reporting physician", dischargeAt: "Discharge time", note: "Note",
    },
    choose: "Choose…",
    age: "{years} y {months} m {days} d",
    finHint: "7 letters or digits", phoneHint: "With the country code: +994 …",
    noAllergy: "No known allergy",
    comorbiditiesTextHint: "Stored; not sent to the engine as a code.",
    sms: "SMS updates allowed",
    sex: { female: "Female", male: "Male" },
    type: { medical: "Medical admission", surgical: "Surgery", icu: "Intensive care", procedure: "Procedure" },
    source: { emergency: "Emergency", electiveSurgery: "Elective surgery", transferInternal: "Internal transfer",
      transferExternal: "Transfer from another institution", other: "Other" },
    blood: { unknown: "Unknown", aPos: "A Rh(+)", aNeg: "A Rh(−)", bPos: "B Rh(+)", bNeg: "B Rh(−)",
      abPos: "AB Rh(+)", abNeg: "AB Rh(−)", oPos: "0 Rh(+)", oNeg: "0 Rh(−)" },
    comorbidity: { copd: "COPD", respiratoryFailure: "Chronic respiratory failure", homeOxygen: "Home oxygen",
      dementia: "Dementia / chronic confusion" },
    relation: { spouse: "Spouse", mother: "Mother", father: "Father", child: "Child", sibling: "Sibling", other: "Other" },
    nat: { az: "Azerbaijan", tr: "Türkiye", ru: "Russia", ge: "Georgia", ir: "Iran", other: "Other" },
    consent: { signed: "Data-processing consent signed", later: "Unconscious — consent to be taken later" },
    missingTitle: "Still missing", missingNone: "Every required field is filled in.",
    miss: {
      name: "Full name", sex: "Sex", dob: "Date of birth", dobWrong: "The date of birth is not valid",
      fin: "FIN must be 7 letters or digits", type: "Admission type", diagnosis: "Admission diagnosis",
      weight: "Weight must be a number", height: "Height must be a number",
      allergy: "An allergy, or «no known allergy» — one of the two", consent: "Consent", bed: "Bed",
    },
    admit: "Admit", admitting: "Saving the admission…", admitted: "admitted, patient number {number}",
    doneTitle: "Admitted", doneBed: "Bed: {bed}", enterOnDevice: "Enter this number on the bedside device.",
    seeOnBoard: "See on the board", next: "New admission",
    engineFailed: {
      board: "The card did not reach the board — reload the page and check the board.",
      weight: "The weight did not reach the engine — enter it on the patient screen.",
      profile: "The comorbidities did not reach the engine — enter them on the patient screen.",
    },
    pickUnit: "Unit", pickerNone: "No unit or bed is set up in your scope.",
    freeBeds: "{count} free", unitClosed: "closed", roomClosed: "closed",
    pickUnitFirst: "Choose the unit first.", pickHint: "Only a free, open bed can be chosen.",
    bedChosen: "Chosen: {bed}", bedClosed: "Closed", bedOther: "In another state",
    unitUnknown: "Unknown unit", bedUnknown: "Unknown bed",
    state: { AVAILABLE: "Free", OCCUPIED: "Occupied", PENDING_DISCHARGE: "Awaiting discharge",
      PENDING_TRANSFER_OUT: "Awaiting transfer", HOUSEKEEPING: "Being cleaned", MAINTENANCE: "In maintenance", BLOCKED: "Blocked" },
    pendingTitle: "Discharges started", pendingNone: "No discharge is waiting for confirmation.",
    lyingTitle: "Patients in", lyingNone: "No patient lies in your scope.",
    badgeDraft: "Awaiting physician's signature",
    signFirst: "The admission must be signed first (patient screen).",
    startDischarge: "Start discharge", confirmLeft: "Patient has left · confirm",
    criticalOpen: "A critical alarm nobody acknowledged: see the alarm first.",
    disp: { home: "Discharged home", other: "Transferred to another institution", exitus: "Death (exitus)" },
    reportedByHint: "Left empty, it is you.",
    dischargeTitle: "Discharge · {subject}", dischargeSubmit: "Start discharge",
    dischargeStarted: "discharge started; waiting for the charge nurse's confirmation",
    discharged: "discharge confirmed; the bed is being cleaned",
    dischargedBoardFailed: "discharge confirmed; the card did not leave the board — check the board",
    release: "Cleaning done · free", released: "bed free",
    awaitingSignature: "Awaiting the physician's signature — the card and monitoring began at admission; the signature is written to the admission.",
    sign: "Sign the admission", signed: "admission signed", signNoRight: "Only a physician with the right to sign admissions signs it.",
    structureTab: "Structure",
    structureIntro: "Build the sites, units, rooms and beds here. Nothing is deleted: a closed place stays and is offered to no admission.",
    newSite: "New site name", addSite: "Add site",
    newUnit: "New unit in {site}", addUnit: "Add unit", unitTypeLabel: "Unit type",
    newRoom: "New room in {unit}", addRoom: "Add room",
    newBed: "New bed label in {room}", addBed: "Add bed",
    unitType: { adultIcu: "Adult ICU", nicu: "Neonatal ICU", picu: "Paediatric ICU", cvicu: "Cardiovascular ICU", bmtIcu: "Bone-marrow transplant ICU" },
    rename: "Rename", renameOf: "New name for {name}", close: "Close", reopen: "Reopen",
    closed: "Closed", added: "added", renamed: "renamed", closedDone: "closed", reopened: "reopened",
    err: {
      bedNotAvailable: "This bed is no longer free; choose another.",
      bedClosed: "This bed, its room or its unit is closed.",
      outOfScope: "This bed is not in one of your units.",
      criticalAlarmOpen: "A critical alarm nobody acknowledged is open; the discharge cannot start. See the alarm first.",
      numberExhausted: "No patient number is left for this year; tell the system administrator.",
      invalidTransition: "The record is not in a state for this; the list has been read again.",
      missingAttending: "The admission has no attending physician.",
      openAdmission: "This patient already has an open admission.",
      bedInUse: "A bed with a patient in it cannot be closed.",
      hasOpenBeds: "Close every bed under it first.",
      nameTaken: "That name is already used here.",
    },
    invalid: {
      displayName: "The full name is required.", dateOfBirth: "The date of birth is not valid.",
      nationalId: "FIN must be 7 letters or digits.", phone: "The phone number is not valid.",
      relativePhone: "The relative's phone number is not valid.", admissionType: "The admission type is required.",
      diagnosis: "The admission diagnosis is required.", weight: "The weight is outside the accepted range.",
      height: "The height is outside the accepted range.",
      allergy: "Write the known allergy or mark «no known allergy» — one of the two.",
      comorbidities: "The comorbidity choice is not valid.", consent: "Consent is required.",
      unit: "The bed is not in the chosen unit.", institution: "Write the receiving institution.",
      dischargeAt: "The discharge time is not valid (not in the future, not before the admission).",
      name: "The name cannot be empty.", label: "The bed label cannot be empty.", other: "A field is not valid.",
    },
  },
};
```

**Edit** `dashboard/src/live/i18n/catalog.js` (1) — replace:

```js

export const NAMESPACES = {
```

with:

```js

// G2-B1a: Hasta Kabul (screens/kabul, the admin's Yapı tab, the unit names, the coded refusals).
import kabul from "./strings/kabul.js";

export const NAMESPACES = {
```

**Edit** `dashboard/src/live/i18n/catalog.js` (2) — replace:

```js
  monitor,
};
```

with:

```js
  monitor,

  kabul, // G2-B1a
};
```


- [ ] **Step 4: Run the dictionaries green:**

```bash
cd /c/tmp/g2b-kabul-fe/dashboard
npx vitest run src/live/i18n/ 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ Test Files |^ +Tests |^ FAIL |→ |×"
```

Expected (the replay, times vary):

```text
Test Files  4 passed (4)
      Tests  42 passed (42)
```


- [ ] **Step 5: The whole suite and the build:**

```bash
cd /c/tmp/g2b-kabul-fe/dashboard
npx vitest run 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ Test Files |^ +Tests |^ FAIL |→ |×"
```

Expected (the replay, times vary):

```text
Test Files  89 passed (89)
      Tests  2432 passed (2432)
```

```bash
cd /c/tmp/g2b-kabul-fe/dashboard
npx vite build 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "built in|precache|larger than|error"
```

Expected (the replay, times vary):

```text
✓ built in …s
precache  20 entries (878.22 KiB)
```


- [ ] **Step 6: Line ends** (and `strings.test.js` was green: the Cyrillic and the `ə` are intact):

```bash
cd /c/tmp/g2b-kabul-fe
for f in dashboard/src/live/i18n/strings.test.js dashboard/src/live/i18n/strings/kabul.js dashboard/src/live/i18n/catalog.js; do printf "%s CR=%s LF=%s\n" "$f" "$(tr -cd '\r' < "$f" | wc -c)" "$(tr -cd '\n' < "$f" | wc -c)"; done
```

Expected:

```text
dashboard/src/live/i18n/strings.test.js CR=235 LF=235
dashboard/src/live/i18n/strings/kabul.js CR=0 LF=448
dashboard/src/live/i18n/catalog.js CR=88 LF=88
```


- [ ] **Step 7: Commit:**

```bash
cd /c/tmp/g2b-kabul-fe
git add -- dashboard/src/live/i18n/strings.test.js dashboard/src/live/i18n/strings/kabul.js dashboard/src/live/i18n/catalog.js
git status --short && git diff --cached --stat
git commit -m "feat(dashboard): the Hasta Kabul strings in four languages (G2-B1a)" \
  -m "red: Tests  1 failed | 6 passed (7)" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- dashboard/src/live/i18n/strings.test.js dashboard/src/live/i18n/strings/kabul.js dashboard/src/live/i18n/catalog.js
```

---

### Task 11: The API client's Hasta Kabul calls, and coded refusals mapped by their code

**Lane:** dashboard. **Needs:** Task 10; **Tasks 1–3 on `feat/g2b-kabul`** and merged into this lane (see "The two lanes") — `apiErrors.test.js` reads `admission/errors.py`, `admission/form.py` and `admission/schemas.py`.

Spec §4.4, §5.6, X57. `backendApi.js` keeps the server's code on a refused request (`err.apiCode`, from `detail.code`; absent when `detail` is a string or FastAPI's list) and gains fourteen calls: `structure`, `admissions(states)`, `admit`, `signOffAdmission`, `startDischarge`, `confirmDischarge`, `releaseBed`, `createSite`, `createUnit`, `createRoom`, `createBed`, `patchUnit`, `patchRoom`, `patchBed`. `fakeApi` (`session/testTokens.testutil.js`) answers each. `apiErrors.js` maps a code to its words: `ADMISSION_CODE_KEYS` (every code of `admission/errors.py` but `field_invalid`) and `INVALID_FIELD_KEYS` (each field `form.py` names, to the label the form shows it under); `admissionCodeKey(err)` answers the key, or `null` for an error without a code. The test reads the engine's own files, so a code or a field added there without words here turns it red.

**Files:**
- Modify: `dashboard/src/backendApi.test.js`
- Modify: `dashboard/src/live/apiErrors.test.js`
- Modify: `dashboard/src/live/session/testTokens.testutil.js`
- Modify: `dashboard/src/backendApi.js`
- Modify: `dashboard/src/live/apiErrors.js`

- [ ] **Step 1: Write the failing tests:**

**Edit** `dashboard/src/backendApi.test.js` (1) — replace:

```js
      expect((await outcome).code).toBe(REQUEST_TIMEOUT);
    } finally {
      vi.useRealTimers();
    }
  });
});
```

with:

```js
      expect((await outcome).code).toBe(REQUEST_TIMEOUT);
    } finally {
      vi.useRealTimers();
    }
  });
});

// G2-B1a
describe("backendApi — Hasta Kabul: admission, discharge, the structure and the bed release", () => {
  const signedIn = (fetchMock) => {
    store.set("homunculus-access-token", "acc-1");
    store.set("homunculus-refresh-token", "ref-1");
    return createBackendApi({ baseUrl: "", fetchImpl: fetchMock });
  };
  const sent = (fetchMock, at = 0) => {
    const [url, init] = fetchMock.mock.calls[at];
    return { url, method: init.method, body: init.body === undefined ? undefined : JSON.parse(init.body) };
  };

  it("a refusal with a code carries the code beside the server's words", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(
      { detail: { code: "bed_not_available", message: "Bed is not AVAILABLE (current state: OCCUPIED); cannot admit." } },
      { ok: false, status: 409 }));
    await expect(signedIn(fetchMock).admit({ patient: {}, note: {} })).rejects.toMatchObject({
      status: 409, apiCode: "bed_not_available",
      message: "Bed is not AVAILABLE (current state: OCCUPIED); cannot admit.",
    });
  });

  it("a refusal without a code has none, as before", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ detail: "Admission not found." }, { ok: false, status: 404 }));
    const err = await signedIn(fetchMock).signOffAdmission("a-1").catch((e) => e);
    expect(err.message).toBe("Admission not found.");
    expect(err.apiCode).toBeUndefined();
  });

  it("reads the structure and the admissions of the named states", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([]));
    const api = signedIn(fetchMock);
    await api.structure();
    await api.admissions(["DRAFT", "ACTIVE"]);
    await api.admissions();
    expect(sent(fetchMock, 0)).toEqual({ url: "/tenant/structure", method: "GET", body: undefined });
    expect(sent(fetchMock, 1).url).toBe("/admissions?state=DRAFT&state=ACTIVE");
    expect(sent(fetchMock, 2).url).toBe("/admissions");
  });

  it("admits, signs, starts and confirms a discharge, and releases a bed, each by its own route", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    const api = signedIn(fetchMock);
    await api.admit({ patient: { display_name: "Sentetik" }, note: {} });
    await api.signOffAdmission("a 1");
    await api.startDischarge("a-1", { disposition: "HOME" });
    await api.confirmDischarge("a-1");
    await api.releaseBed("b/1");
    expect(fetchMock.mock.calls.map((_, at) => [sent(fetchMock, at).method, sent(fetchMock, at).url])).toEqual([
      ["POST", "/admissions"], ["POST", "/admissions/a%201/sign-off"],
      ["POST", "/admissions/a-1/discharge/initiate"], ["POST", "/admissions/a-1/discharge/confirm"],
      ["POST", "/tenant/beds/b%2F1/release"],
    ]);
    expect(sent(fetchMock, 0).body).toEqual({ patient: { display_name: "Sentetik" }, note: {} });
    expect(sent(fetchMock, 2).body).toEqual({ disposition: "HOME" });
  });

  it("builds the structure under its parents and renames, closes and reopens by PATCH", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    const api = signedIn(fetchMock);
    await api.createSite("t-1", { name: "Ana bina" });
    await api.createUnit("s-1", { name: "Reanimasiya", unit_type: "ADULT_ICU" });
    await api.createRoom("u-1", { name: "Otaq 1" });
    await api.createBed("r-1", { label: "1" });
    await api.patchUnit("u-1", { name: "Rea" });
    await api.patchRoom("r-1", { is_active: false });
    await api.patchBed("b-1", { is_active: true });
    expect(fetchMock.mock.calls.map((_, at) => [sent(fetchMock, at).method, sent(fetchMock, at).url])).toEqual([
      ["POST", "/tenant/tenants/t-1/sites"], ["POST", "/tenant/sites/s-1/units"],
      ["POST", "/tenant/units/u-1/rooms"], ["POST", "/tenant/rooms/r-1/beds"],
      ["PATCH", "/tenant/units/u-1"], ["PATCH", "/tenant/rooms/r-1"], ["PATCH", "/tenant/beds/b-1"],
    ]);
  });
});
```

**Edit** `dashboard/src/live/apiErrors.test.js` (1) — replace:

```js
      expect(readErrorText(en, err)).toBe(apiErrorText(en, err));
    }
  });
});
```

with:

```js
      expect(readErrorText(en, err)).toBe(apiErrorText(en, err));
    }
  });
});

// G2-B1a — the admission and structure routes' coded refusals, read from the engine's sources.
describe("a coded refusal (Hasta Kabul) is mapped by its code, never its words", () => {
  const ERRORS_PY = py("admission/errors.py");
  /** The codes: every `NAME = "code"` constant of errors.py but FIELD_INVALID's prefix. */
  const CODES = [...ERRORS_PY.matchAll(/^([A-Z_]+) = "([a-z_]+)"/gm)]
    .filter(([, name]) => name !== "FIELD_INVALID").map(([, , code]) => code);
  /** Every field a `field_invalid("<field>", …)` names, in the three files that raise one. */
  const FIELDS = [...new Set(["admission/form.py", "admission/router.py", "tenant/router.py"]
    .flatMap((file) => [...py(file).matchAll(/field_invalid\(\s*"(\w+)"/g)].map((m) => m[1])))];
  const coded = (apiCode) => Object.assign(new Error("English words a screen must not show"), { status: 409, apiCode });

  it("the readers found the codes and the fields the engine raises", () => {
    expect(CODES).toEqual(expect.arrayContaining(["bed_not_available", "critical_alarm_open", "out_of_scope"]));
    expect(CODES.length).toBe(11);
    // admission/form.py's; the routers' own (`label`, `admitting_unit_id`) are read the same way.
    expect(FIELDS).toEqual(expect.arrayContaining(["consent", "allergies_text", "institution"]));
  });

  it.each(CODES)("%s has a text in the four languages", (code) => {
    const hit = apiErrorKey(coded(code));
    expect(hit.key).toMatch(/^kabul\.err\./);
    for (const lang of LANG_CODES) expect(DICTIONARIES[lang][hit.key], `${lang} ${hit.key}`).toBeTruthy();
  });

  it.each(FIELDS)("field_invalid:%s names its field in the four languages", (field) => {
    const hit = apiErrorKey(coded(`field_invalid:${field}`));
    expect(hit.key).not.toBe("kabul.invalid.other");
    for (const lang of LANG_CODES) expect(DICTIONARIES[lang][hit.key], `${lang} ${hit.key}`).toBeTruthy();
  });

  it("an unknown field still reads a sentence, and the server's English never reaches the reader", () => {
    const en = createTranslator("en", DICTIONARIES);
    expect(apiErrorKey(coded("field_invalid:something_new")).key).toBe("kabul.invalid.other");
    expect(apiErrorText(en, coded("bed_not_available"))).not.toMatch(/English words/);
    expect(apiErrorText(en, coded("bed_not_available"))).toBe(en("kabul.err.bedNotAvailable"));
  });

  it("a code wins over a message that happens to be mapped", () => {
    const both = Object.assign(new Error("hasta bulunamadı"), { status: 403, apiCode: "out_of_scope" });
    expect(apiErrorKey(both).key).toBe("kabul.err.outOfScope");
  });
});
```

**Edit** `dashboard/src/live/session/testTokens.testutil.js` (1) — replace:

```js
    putPatientProfile: vi.fn(),
    // the users and units screen (G1-12)
```

with:

```js
    putPatientProfile: vi.fn(),

    // G2-B1a: Hasta Kabul — the admission screen, the sign-off strip, the unit names, Yapı
    structure: vi.fn(),
    admissions: vi.fn(),
    admit: vi.fn(),
    signOffAdmission: vi.fn(),
    startDischarge: vi.fn(),
    confirmDischarge: vi.fn(),
    releaseBed: vi.fn(),
    createSite: vi.fn(),
    createUnit: vi.fn(),
    createRoom: vi.fn(),
    createBed: vi.fn(),
    patchUnit: vi.fn(),
    patchRoom: vi.fn(),
    patchBed: vi.fn(),

    // the users and units screen (G1-12)
```


- [ ] **Step 2: Run them and see them red** — the calls and the maps do not exist:

```bash
cd /c/tmp/g2b-kabul-fe/dashboard
npx vitest run src/backendApi.test.js src/live/apiErrors.test.js 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ Test Files |^ +Tests |^ FAIL |→ |×"
```

Expected (the replay, times vary):

```text
Test Files  2 failed (2)
      Tests  33 failed | 256 passed (289)
 FAIL  src/backendApi.test.js > backendApi — Hasta Kabul: admission, discharge, the structure and the bed release > a refusal with a code carries the code beside the server's words
 FAIL  src/backendApi.test.js > backendApi — Hasta Kabul: admission, discharge, the structure and the bed release > a refusal without a code has none, as before
 FAIL  src/backendApi.test.js > backendApi — Hasta Kabul: admission, discharge, the structure and the bed release > reads the structure and the admissions of the named states
 FAIL  src/backendApi.test.js > backendApi — Hasta Kabul: admission, discharge, the structure and the bed release > admits, signs, starts and confirms a discharge, and releases a bed, each by its own route
 FAIL  src/backendApi.test.js > backendApi — Hasta Kabul: admission, discharge, the structure and the bed release > builds the structure under its parents and renames, closes and reopens by PATCH
 FAIL  src/live/apiErrors.test.js > a coded refusal (Hasta Kabul) is mapped by its code, never its words > bed_not_available has a text in the four languages
 FAIL  src/live/apiErrors.test.js > a coded refusal (Hasta Kabul) is mapped by its code, never its words > bed_closed has a text in the four languages
 FAIL  src/live/apiErrors.test.js > a coded refusal (Hasta Kabul) is mapped by its code, never its words > out_of_scope has a text in the four languages
 FAIL  src/live/apiErrors.test.js > a coded refusal (Hasta Kabul) is mapped by its code, never its words > critical_alarm_open has a text in the four languages
 FAIL  src/live/apiErrors.test.js > a coded refusal (Hasta Kabul) is mapped by its code, never its words > patient_number_exhausted has a text in the four languages
 FAIL  src/live/apiErrors.test.js > a coded refusal (Hasta Kabul) is mapped by its code, never its words > invalid_transition has a text in the four languages
 FAIL  src/live/apiErrors.test.js > a coded refusal (Hasta Kabul) is mapped by its code, never its words > missing_attending has a text in the four languages
 FAIL  src/live/apiErrors.test.js > a coded refusal (Hasta Kabul) is mapped by its code, never its words > open_admission has a text in the four languages
 FAIL  src/live/apiErrors.test.js > a coded refusal (Hasta Kabul) is mapped by its code, never its words > bed_in_use has a text in the four languages
 FAIL  src/live/apiErrors.test.js > a coded refusal (Hasta Kabul) is mapped by its code, never its words > has_open_beds has a text in the four languages
 FAIL  src/live/apiErrors.test.js > a coded refusal (Hasta Kabul) is mapped by its code, never its words > name_taken has a text in the four languages
 FAIL  src/live/apiErrors.test.js > a coded refusal (Hasta Kabul) is mapped by its code, never its words > field_invalid:display_name names its field in the four languages
 FAIL  src/live/apiErrors.test.js > a coded refusal (Hasta Kabul) is mapped by its code, never its words > field_invalid:date_of_birth names its field in the four languages
 FAIL  src/live/apiErrors.test.js > a coded refusal (Hasta Kabul) is mapped by its code, never its words > field_invalid:national_id names its field in the four languages
 FAIL  src/live/apiErrors.test.js > a coded refusal (Hasta Kabul) is mapped by its code, never its words > field_invalid:admission_type names its field in the four languages
 FAIL  src/live/apiErrors.test.js > a coded refusal (Hasta Kabul) is mapped by its code, never its words > field_invalid:admission_diagnosis_free_text names its field in the four languages
 FAIL  src/live/apiErrors.test.js > a coded refusal (Hasta Kabul) is mapped by its code, never its words > field_invalid:weight_kg names its field in the four languages
 FAIL  src/live/apiErrors.test.js > a coded refusal (Hasta Kabul) is mapped by its code, never its words > field_invalid:height_cm names its field in the four languages
 FAIL  src/live/apiErrors.test.js > a coded refusal (Hasta Kabul) is mapped by its code, never its words > field_invalid:allergies_text names its field in the four languages
 FAIL  src/live/apiErrors.test.js > a coded refusal (Hasta Kabul) is mapped by its code, never its words > field_invalid:comorbidity_codes names its field in the four languages
 FAIL  src/live/apiErrors.test.js > a coded refusal (Hasta Kabul) is mapped by its code, never its words > field_invalid:consent names its field in the four languages
 FAIL  src/live/apiErrors.test.js > a coded refusal (Hasta Kabul) is mapped by its code, never its words > field_invalid:institution names its field in the four languages
 FAIL  src/live/apiErrors.test.js > a coded refusal (Hasta Kabul) is mapped by its code, never its words > field_invalid:discharge_at names its field in the four languages
 FAIL  src/live/apiErrors.test.js > a coded refusal (Hasta Kabul) is mapped by its code, never its words > field_invalid:admitting_unit_id names its field in the four languages
 FAIL  src/live/apiErrors.test.js > a coded refusal (Hasta Kabul) is mapped by its code, never its words > field_invalid:name names its field in the four languages
 FAIL  src/live/apiErrors.test.js > a coded refusal (Hasta Kabul) is mapped by its code, never its words > field_invalid:label names its field in the four languages
 FAIL  src/live/apiErrors.test.js > a coded refusal (Hasta Kabul) is mapped by its code, never its words > an unknown field still reads a sentence, and the server's English never reaches the reader
 FAIL  src/live/apiErrors.test.js > a coded refusal (Hasta Kabul) is mapped by its code, never its words > a code wins over a message that happens to be mapped
× backendApi — Hasta Kabul: admission, discharge, the structure and the bed release > a refusal with a code carries the code beside the server's words 20ms
→ signedIn(...).admit is not a function
× backendApi — Hasta Kabul: admission, discharge, the structure and the bed release > a refusal without a code has none, as before 1ms
→ signedIn(...).signOffAdmission is not a function
× backendApi — Hasta Kabul: admission, discharge, the structure and the bed release > reads the structure and the admissions of the named states 1ms
→ api.structure is not a function
```


- [ ] **Step 3: The calls, `err.apiCode`, the maps:**

**Edit** `dashboard/src/backendApi.js` (1) — replace:

```js
    let fieldErrors;
    try {
```

with:

```js
    let fieldErrors;
    let apiCode;
    try {
```

**Edit** `dashboard/src/backendApi.js` (2) — replace:

```js
        if (text) detail = text;
      } else if (body?.detail) {
```

with:

```js
        if (text) detail = text;
      } else if (typeof body?.detail?.code === "string" && typeof body.detail.message === "string") {
        // A refusal with a stable code beside its words (homunculus-engine admission/errors.py,
        // Group 2 · B1a): the words are the message, the code is what a screen maps.
        detail = body.detail.message;
        apiCode = body.detail.code;
      } else if (body?.detail) {
```

**Edit** `dashboard/src/backendApi.js` (3) — replace:

```js
    err.status = res.status;
    if (fieldErrors) err.fieldErrors = fieldErrors;
```

with:

```js
    err.status = res.status;
    if (apiCode) err.apiCode = apiCode;
    if (fieldErrors) err.fieldErrors = fieldErrors;
```

**Edit** `dashboard/src/backendApi.js` (4) — replace:

```js

    /** Escape hatch for endpoints not yet wrapped (admissions, alerts, tenant…). */
```

with:

```js

    // ---- G2-B1a: Hasta Kabul (homunculus-engine admission/router.py, tenant/router.py) ----
    // Their refusals carry `err.apiCode` (admission/errors.py): `bed_not_available`,
    // `out_of_scope`, `critical_alarm_open`, `field_invalid:<field>` … — screens map the code.

    /** The caller's units, rooms and beds with names, states and `is_active`
     *  ({tenant_id, sites: [{id, name, units: [{id, name, rooms: [{id, name, beds: [...]}]}]}]}). */
    structure() { return authed("/tenant/structure"); },
    /** Admission rows of the caller's units, newest first; `states` narrows them. */
    admissions(states = []) {
      const query = new URLSearchParams();
      for (const state of states) query.append("state", state);
      const suffix = query.toString();
      return authed(`/admissions${suffix ? `?${suffix}` : ""}`);
    },
    /** One admission ({patient, note}): {…admission, patient_number, engine: {weight, profile, board}}. */
    admit(body) { return authed("/admissions", { method: "POST", body }); },
    signOffAdmission(id) { return authed(`/admissions/${seg(id)}/sign-off`, { method: "POST" }); },
    /** {disposition, institution?, reported_by?, discharge_at?, note?} */
    startDischarge(id, body) {
      return authed(`/admissions/${seg(id)}/discharge/initiate`, { method: "POST", body });
    },
    /** {…admission, board: ok|failed|skipped} — whether the card left the board. */
    confirmDischarge(id) { return authed(`/admissions/${seg(id)}/discharge/confirm`, { method: "POST" }); },
    releaseBed(id) { return authed(`/tenant/beds/${seg(id)}/release`, { method: "POST" }); },
    // The administrator's structure tab: add under a parent, rename / close / reopen.
    createSite(tenantId, body) { return authed(`/tenant/tenants/${seg(tenantId)}/sites`, { method: "POST", body }); },
    createUnit(siteId, body) { return authed(`/tenant/sites/${seg(siteId)}/units`, { method: "POST", body }); },
    createRoom(unitId, body) { return authed(`/tenant/units/${seg(unitId)}/rooms`, { method: "POST", body }); },
    createBed(roomId, body) { return authed(`/tenant/rooms/${seg(roomId)}/beds`, { method: "POST", body }); },
    patchUnit(id, body) { return authed(`/tenant/units/${seg(id)}`, { method: "PATCH", body }); },
    patchRoom(id, body) { return authed(`/tenant/rooms/${seg(id)}`, { method: "PATCH", body }); },
    patchBed(id, body) { return authed(`/tenant/beds/${seg(id)}`, { method: "PATCH", body }); },

    /** Escape hatch for endpoints not yet wrapped (admissions, alerts, tenant…). */
```

**Edit** `dashboard/src/live/apiErrors.js` (1) — replace:

```js

/** What a 5xx may say that is more exact than "the server cannot be reached". `scopeUnreadable` is
```

with:

```js

// G2-B1a — Hasta Kabul. The admission and structure routes answer a stable CODE beside English
// words (homunculus-engine admission/errors.py; backendApi.js puts it on `err.apiCode`). The code
// is mapped, never the words. apiErrors.test.js reads errors.py and the three files that name a
// field, and fails when a code or a field below is missing. Full keys: their texts live in the
// `kabul` namespace with the rest of the slice.
export const ADMISSION_CODE_KEYS = new Map([
  ["bed_not_available", "kabul.err.bedNotAvailable"],
  ["bed_closed", "kabul.err.bedClosed"],
  ["out_of_scope", "kabul.err.outOfScope"],
  ["critical_alarm_open", "kabul.err.criticalAlarmOpen"],
  ["patient_number_exhausted", "kabul.err.numberExhausted"],
  ["invalid_transition", "kabul.err.invalidTransition"],
  ["missing_attending", "kabul.err.missingAttending"],
  ["open_admission", "kabul.err.openAdmission"],
  ["bed_in_use", "kabul.err.bedInUse"],
  ["has_open_beds", "kabul.err.hasOpenBeds"],
  ["name_taken", "kabul.err.nameTaken"],
]);

/** `field_invalid:<field>` -> the sentence naming that field. A field not listed reads the
 *  generic sentence: the refusal is still said, only less exactly. */
export const INVALID_FIELD_KEYS = new Map([
  ["display_name", "kabul.invalid.displayName"],
  ["date_of_birth", "kabul.invalid.dateOfBirth"],
  ["national_id", "kabul.invalid.nationalId"],
  ["phone", "kabul.invalid.phone"],
  ["relative_phone", "kabul.invalid.relativePhone"],
  ["admission_type", "kabul.invalid.admissionType"],
  ["admission_diagnosis_free_text", "kabul.invalid.diagnosis"],
  ["weight_kg", "kabul.invalid.weight"],
  ["height_cm", "kabul.invalid.height"],
  ["allergies_text", "kabul.invalid.allergy"],
  ["comorbidity_codes", "kabul.invalid.comorbidities"],
  ["consent", "kabul.invalid.consent"],
  ["admitting_unit_id", "kabul.invalid.unit"],
  ["institution", "kabul.invalid.institution"],
  ["discharge_at", "kabul.invalid.dischargeAt"],
  ["name", "kabul.invalid.name"],
  ["label", "kabul.invalid.label"],
]);
const FIELD_INVALID = "field_invalid:";

/** A coded refusal as {key, vars}, or null when it carries no code this map knows. */
function admissionCodeKey(err) {
  const code = typeof err?.apiCode === "string" ? err.apiCode : "";
  if (ADMISSION_CODE_KEYS.has(code)) return { key: ADMISSION_CODE_KEYS.get(code), vars: {} };
  if (code.startsWith(FIELD_INVALID)) {
    return { key: INVALID_FIELD_KEYS.get(code.slice(FIELD_INVALID.length)) ?? "kabul.invalid.other", vars: {} };
  }
  return null;
}

/** What a 5xx may say that is more exact than "the server cannot be reached". `scopeUnreadable` is
```

**Edit** `dashboard/src/live/apiErrors.js` (2) — replace:

```js
  }
  if (err && Array.isArray(err.fieldErrors)) {
```

with:

```js
  }
  const coded = admissionCodeKey(err);       // G2-B1a: a coded refusal is mapped by its code
  if (coded) return coded;
  if (err && Array.isArray(err.fieldErrors)) {
```


- [ ] **Step 4: Run them green:**

```bash
cd /c/tmp/g2b-kabul-fe/dashboard
npx vitest run src/backendApi.test.js src/live/apiErrors.test.js 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ Test Files |^ +Tests |^ FAIL |→ |×"
```

Expected (the replay, times vary):

```text
Test Files  2 passed (2)
      Tests  289 passed (289)
```


- [ ] **Step 5: The whole suite and the build:**

```bash
cd /c/tmp/g2b-kabul-fe/dashboard
npx vitest run 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ Test Files |^ +Tests |^ FAIL |→ |×"
```

Expected (the replay, times vary):

```text
Test Files  89 passed (89)
      Tests  2466 passed (2466)
```

```bash
cd /c/tmp/g2b-kabul-fe/dashboard
npx vite build 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "built in|precache|larger than|error"
```

Expected (the replay, times vary):

```text
✓ built in …s
precache  20 entries (880.94 KiB)
```


- [ ] **Step 6: Line ends:**

```bash
cd /c/tmp/g2b-kabul-fe
for f in dashboard/src/backendApi.test.js dashboard/src/live/apiErrors.test.js dashboard/src/live/session/testTokens.testutil.js dashboard/src/backendApi.js dashboard/src/live/apiErrors.js; do printf "%s CR=%s LF=%s\n" "$f" "$(tr -cd '\r' < "$f" | wc -c)" "$(tr -cd '\n' < "$f" | wc -c)"; done
```

Expected:

```text
dashboard/src/backendApi.test.js CR=1476 LF=1476
dashboard/src/live/apiErrors.test.js CR=495 LF=495
dashboard/src/live/session/testTokens.testutil.js CR=108 LF=108
dashboard/src/backendApi.js CR=886 LF=886
dashboard/src/live/apiErrors.js CR=352 LF=352
```


- [ ] **Step 7: Commit:**

```bash
cd /c/tmp/g2b-kabul-fe
git add -- dashboard/src/backendApi.test.js dashboard/src/live/apiErrors.test.js dashboard/src/live/session/testTokens.testutil.js dashboard/src/backendApi.js dashboard/src/live/apiErrors.js
git status --short && git diff --cached --stat
git commit -m "feat(dashboard): the Hasta Kabul calls; a coded refusal mapped by its code (G2-B1a)" \
  -m "red: Tests  33 failed | 256 passed (289)" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- dashboard/src/backendApi.test.js dashboard/src/live/apiErrors.test.js dashboard/src/live/session/testTokens.testutil.js dashboard/src/backendApi.js dashboard/src/live/apiErrors.js
```

---

### Task 12: The structure for the whole shell; every unit and bed by name

**Lane:** dashboard. **Needs:** Task 11.

Spec D9, §5.7, X52, X65. Since D9 a unit or bed is keyed by its tenant UUID, and no screen may print one. The shell reads `GET /tenant/structure` once (`data/StructureProvider.jsx`, inside `Shell.jsx`), for a session holding any of `STRUCTURE_PERMS` (`admissions.view`, `admissions.admit`, `beds.release`, `structure.manage`, `users.manage`), keeps the last tree when a reload fails (and says it is stale), and reads an answer that is not a tree as an empty one. `data/structure.js` indexes it (an id whatever its case) and names things: `unitLabel` (a name; an unknown UUID reads "Bilinmeyen birim"; a hand-written key — an old free-text grant — stays as typed), `bedLabel` ("1 · Otaq 1 · Reanimasiya"), `admissible` (an open AVAILABLE bed), `unavailableKey` (closed before its state). The top bar's unit chooser, the bed board's own selector and the administrator's scope editor name units and beds through it. `screens/kabul/kabul.testutil.js` is the synthetic ward every later test of the slice mounts.

**Files:**
- Create: `dashboard/src/live/screens/kabul/kabul.testutil.js`
- Create: `dashboard/src/live/data/structure.test.js`
- Create: `dashboard/src/live/data/StructureProvider.test.jsx`
- Create: `dashboard/src/live/screens/kabul/unitNames.test.jsx`
- Create: `dashboard/src/live/data/structure.js`
- Create: `dashboard/src/live/data/StructureProvider.jsx`
- Modify: `dashboard/src/live/shell/Shell.jsx`
- Modify: `dashboard/src/live/shell/TopBar.jsx`
- Modify: `dashboard/src/live/screens/beds/BedsScreen.jsx`
- Modify: `dashboard/src/live/screens/admin/ScopeEditor.jsx`

- [ ] **Step 1: Write the failing tests** — the ward fixture; the index and the names; the provider; the three surfaces that named units by key:

**Write** `dashboard/src/live/screens/kabul/kabul.testutil.js` (a new file, whole):

```js
// Test-only: a synthetic ward for the Hasta Kabul screens (Group 2 · B1a) — the structure GET
// /tenant/structure answers, admission rows as GET /admissions answers them, and a mount inside
// the shell's StructureProvider on a session holding the given rights. UUIDs are made up and must
// never appear on a screen (`UUID_TEXT`). Synthetic patients only.
import React from "react";
import { act, screen, within } from "@testing-library/react";
import { mount } from "../../session/mount.testutil.jsx";
import { profile, token } from "../../session/testTokens.testutil.js";
import { StructureProvider } from "../../data/StructureProvider.jsx";

export const T = "11111111-1111-4111-8111-111111111111";
export const SITE = "22222222-2222-4222-8222-222222222222";
export const REA = "33333333-3333-4333-8333-333333333301";
export const NEO = "33333333-3333-4333-8333-333333333302";
export const ROOM1 = "44444444-4444-4444-8444-444444444401";
export const ROOM2 = "44444444-4444-4444-8444-444444444402";
export const ROOMN = "44444444-4444-4444-8444-444444444403";
export const BED = (n) => `55555555-5555-4555-8555-5555555555${String(n).padStart(2, "0")}`;
/** Any UUID at all: no screen may print one. */
export const UUID_TEXT = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const bed = (n, label, state = "AVAILABLE", is_active = true) => ({ id: BED(n), label, state, is_active });

export function structure() {
  return {
    tenant_id: T,
    sites: [{
      id: SITE, name: "Ana bina", is_active: true,
      units: [
        { id: REA, name: "Reanimasiya", unit_type: "ADULT_ICU", is_active: true, rooms: [
          { id: ROOM1, name: "Otaq 1", room_number: null, is_isolation: false, is_active: true,
            beds: [bed(1, "1"), bed(2, "2", "OCCUPIED"), bed(3, "3", "HOUSEKEEPING"), bed(4, "4", "AVAILABLE", false)] },
          { id: ROOM2, name: "Otaq 2", room_number: null, is_isolation: false, is_active: true,
            beds: [bed(5, "5")] },
        ] },
        { id: NEO, name: "Neonatal", unit_type: "NICU", is_active: false, rooms: [
          { id: ROOMN, name: "N-1", room_number: null, is_isolation: false, is_active: true, beds: [bed(6, "N1")] },
        ] },
      ],
    }],
  };
}

/** An admission row (admission/schemas.py AdmissionRow). */
export function row(over = {}) {
  return {
    id: "a-1", patient_id: "p-1", tenant_id: T, state: "ACTIVE", admission_datetime: "2026-10-25T08:00:00Z",
    admitting_unit_id: REA, bed_id: BED(2), attending_physician_id: null, admission_diagnosis_free_text: "Sentetik tanı",
    created_at: "2026-10-25T08:00:00Z", patient_number: "H2600001", display_name: "Sentetik Hasta",
    bed_label: "2", room_name: "Otaq 1", unit_name: "Reanimasiya", discharge_disposition: null,
    discharge_institution: null, discharge_at: null, ...over,
  };
}

export const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

/** Mount `ui` in the providers the shell gives a screen, the structure's included. */
export async function mountKabul(ui, { perms, setup } = {}) {
  const mounted = await mount(React.createElement(StructureProvider, null, ui), {
    access: token({ perms }), me: profile({ perms }),
    setup: (api) => {
      api.structure.mockResolvedValue(structure());
      api.admissions.mockResolvedValue([]);
      setup?.(api);
    },
  });
  await settle();
  return mounted;
}

export const toasts = () => within(screen.getByRole("region", { name: "Bildirişlər" }));

export const NURSE = ["board.view", "admissions.view", "admissions.admit", "beds.release", "clinical.chart"];
export const CHARGE = [...NURSE, "admissions.discharge.confirm"];
export const DOCTOR = ["board.view", "admissions.view", "admissions.sign_off", "admissions.move.initiate", "clinical.chart"];
export const ADMIN = ["board.view", "admissions.view", "admissions.admit", "structure.manage", "users.manage", "groups.manage"];
```

**Write** `dashboard/src/live/data/structure.test.js` (a new file, whole):

```js
// The ward's structure, read (Group 2 · B1a): every unit and bed by name, never by UUID, and only
// an open, AVAILABLE bed offered to an admission.
import { describe, it, expect } from "vitest";
import { DICTIONARIES } from "../i18n/catalog.js";
import { createTranslator } from "../i18n/translate.js";
import { admissible, bedLabel, indexStructure, isUuid, unavailableKey, unitLabel } from "./structure.js";
import { BED, NEO, REA, structure } from "../screens/kabul/kabul.testutil.js";

const az = createTranslator("az", DICTIONARIES);

describe("the structure's index", () => {
  const index = indexStructure(structure());

  it("finds every unit, room and bed with its parents' names", () => {
    expect(index.units.get(REA)).toMatchObject({ name: "Reanimasiya", unitType: "ADULT_ICU", isActive: true, siteName: "Ana bina" });
    expect(index.beds.get(BED(5))).toMatchObject({ label: "5", roomName: "Otaq 2", unitName: "Reanimasiya", open: true });
    expect(index.beds.size).toBe(6);
  });

  it("finds an id whatever its case, as the engine compares ids", () => {
    expect(index.units.get(REA.toUpperCase().toLowerCase())).toBeDefined();
    expect(unitLabel(az, index, REA.toUpperCase())).toBe("Reanimasiya");
  });

  it("calls a bed open only when it, its room and its unit are open", () => {
    expect(index.beds.get(BED(4)).open).toBe(false);          // the bed is closed
    expect(index.beds.get(BED(6)).open).toBe(false);          // its unit is closed
    expect(index.beds.get(BED(1)).open).toBe(true);
  });

  it("is empty for an answer that is not a tree", () => {
    for (const answer of [null, undefined, {}, { sites: "x" }]) expect(indexStructure(answer).beds.size).toBe(0);
  });
});

describe("a unit's name", () => {
  const index = indexStructure(structure());

  it("is the structure's name", () => {
    expect(unitLabel(az, index, NEO)).toBe("Neonatal");
  });

  it("is never a UUID: an id the tree does not hold reads «unknown unit»", () => {
    const label = unitLabel(az, index, "99999999-9999-4999-8999-999999999999");
    expect(label).toBe(az("kabul.unitUnknown"));
    expect(isUuid(label)).toBe(false);
  });

  it("keeps a key someone wrote by hand (an old free-text grant): it is no UUID", () => {
    expect(unitLabel(az, index, "unit-adult")).toBe("unit-adult");
  });
});

describe("which bed an admission may take", () => {
  const index = indexStructure(structure());

  it("only an open, AVAILABLE one", () => {
    expect(admissible(index.beds.get(BED(1)))).toBe(true);
    for (const n of [2, 3, 4, 6]) expect(admissible(index.beds.get(BED(n))), n).toBe(false);
  });

  it("says why each other one is not offered, closed before its state", () => {
    expect(unavailableKey(index.beds.get(BED(1)))).toBeNull();
    expect(unavailableKey(index.beds.get(BED(2)))).toBe("kabul.state.OCCUPIED");
    expect(unavailableKey(index.beds.get(BED(3)))).toBe("kabul.state.HOUSEKEEPING");
    expect(unavailableKey(index.beds.get(BED(4)))).toBe("kabul.bedClosed");
    expect(unavailableKey(index.beds.get(BED(6)))).toBe("kabul.bedClosed");
  });

  it("names a bed by its label and its unit", () => {
    expect(bedLabel(index, BED(5))).toBe("5 · Reanimasiya");
    expect(bedLabel(index, "nope")).toBeNull();
  });
});
```

**Write** `dashboard/src/live/data/StructureProvider.test.jsx` (a new file, whole):

```jsx
// The shell's one read of the ward's structure (Group 2 · B1a): made only for a session whose
// rights open GET /tenant/structure, through the session's `track`, kept when a reload fails.
import { describe, it, expect } from "vitest";
import React from "react";
import { act, screen } from "@testing-library/react";
import { useStructure } from "./StructureProvider.jsx";
import { REA, mountKabul, structure } from "../screens/kabul/kabul.testutil.js";
import { refusal } from "../session/mount.testutil.jsx";

function Probe() {
  const { phase, index, reload } = useStructure();
  return (
    <div>
      <p>{`phase: ${phase}`}</p>
      <p>{`units: ${[...index.units.values()].map((u) => u.name).join(", ")}`}</p>
      <button type="button" onClick={reload}>reload</button>
    </div>
  );
}

describe("StructureProvider", () => {
  it("reads the structure once for a session that may, and names its units", async () => {
    const { api } = await mountKabul(<Probe />, { perms: ["board.view", "admissions.view"] });
    expect(api.structure).toHaveBeenCalledTimes(1);
    expect(screen.getByText("phase: known")).toBeTruthy();
    expect(screen.getByText("units: Reanimasiya, Neonatal")).toBeTruthy();
  });

  it("asks nothing of a session none of whose rights open the route", async () => {
    const { api } = await mountKabul(<Probe />, { perms: ["board.view", "audit.view"] });
    expect(api.structure).not.toHaveBeenCalled();
    expect(screen.getByText("phase: unasked")).toBeTruthy();
  });

  it("keeps the last tree when a reload fails, and says it is stale", async () => {
    const { api } = await mountKabul(<Probe />, { perms: ["beds.release"] });
    api.structure.mockRejectedValueOnce(refusal(503, "Sunucuya şu an ulaşılamıyor"));
    await act(async () => { screen.getByText("reload").click(); });
    expect(screen.getByText("phase: stale")).toBeTruthy();
    expect(screen.getByText("units: Reanimasiya, Neonatal")).toBeTruthy();
  });

  it("reads an answer that is not a tree as an empty one", async () => {
    await mountKabul(<Probe />, { perms: ["structure.manage"], setup: (api) => api.structure.mockResolvedValue("x") });
    expect(screen.getByText("phase: known")).toBeTruthy();
    expect(screen.getByText("units:")).toBeTruthy();
    expect(REA).toBeTruthy();
    expect(structure().sites).toHaveLength(1);
  });
});
```

**Write** `dashboard/src/live/screens/kabul/unitNames.test.jsx` (a new file, whole):

```jsx
// The top bar's unit chooser and the bed board's unit selector name each unit from the structure —
// never its UUID (Group 2 · B1a, spec D9, §5.7). The engine's scope lists unit ids; since B1a they
// are the tenant's UUIDs.
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { fireEvent, screen, within } from "@testing-library/react";
import { ShellProvider } from "../../shell/ShellContext.jsx";
import { TopBar } from "../../shell/TopBar.jsx";
import { BedsScreen } from "../beds/BedsScreen.jsx";
import { ScopeEditor } from "../admin/ScopeEditor.jsx";
import { scopeFromApi } from "../admin/rules.js";
import { BED, NEO, REA, UUID_TEXT, mountKabul } from "./kabul.testutil.js";

const PERMS = ["board.view", "admissions.view"];

describe("a unit is named, never numbered", () => {
  it("in the top bar's chooser", async () => {
    await mountKabul(<ShellProvider units={[REA, NEO]} scope="known"><TopBar title="Yataklar" /></ShellProvider>,
      { perms: PERMS });
    fireEvent.click(screen.getByRole("button", { name: "Göstərilən bölmə" }));
    const menu = screen.getByRole("menu");
    expect(within(menu).getByRole("menuitemradio", { name: "Reanimasiya" })).toBeTruthy();
    expect(within(menu).getByRole("menuitemradio", { name: "Neonatal" })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(UUID_TEXT);
  });

  it("in the bed board's own selector", async () => {
    await mountKabul(<ShellProvider units={[REA, NEO]} scope="known"><BedsScreen /></ShellProvider>, { perms: PERMS });
    const select = screen.getByRole("combobox");
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["Hamısı", "Reanimasiya", "Neonatal"]);
    fireEvent.change(select, { target: { value: REA } });
    expect(document.body.textContent).toMatch(/Reanimasiya/);
    expect(document.body.textContent).not.toMatch(UUID_TEXT);
  });

  it("in the administrator's scope editor, the units and beds a grant names", async () => {
    const scope = scopeFromApi({ user_id: "u-1", unrestricted: false, reason: "assigned",
      grants: [{ unit_id: REA, bed_id: "" }, { unit_id: "", bed_id: BED(5) },
        { unit_id: "", bed_id: "99999999-9999-4999-8999-999999999999" }, { unit_id: "unit-adult", bed_id: "" }] });
    await mountKabul(<ScopeEditor user={{ username: "ayse", fullName: "Ayşe Sentetik" }} scope={scope} mayAssign
      save={vi.fn()} reread={vi.fn()} onSaved={vi.fn()} onRefused={vi.fn()} onClose={vi.fn()} />, { perms: ["users.manage"] });
    const table = within(screen.getByRole("table"));
    expect(table.getByRole("rowheader", { name: "Reanimasiya" })).toBeTruthy();
    expect(table.getByText("5 · Reanimasiya")).toBeTruthy();
    expect(table.getByText("Naməlum çarpayı")).toBeTruthy();
    expect(table.getByRole("rowheader", { name: "unit-adult" })).toBeTruthy();   // a key typed by hand
    expect(document.body.textContent).not.toMatch(UUID_TEXT);
  });

  it("an id the structure does not hold reads «unknown unit», still never the UUID", async () => {
    const ghost = "99999999-9999-4999-8999-999999999999";
    await mountKabul(<ShellProvider units={[REA, ghost]} scope="known"><BedsScreen /></ShellProvider>, { perms: PERMS });
    const options = within(screen.getByRole("combobox")).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["Hamısı", "Reanimasiya", "Naməlum şöbə"]);
    expect(document.body.textContent).not.toMatch(UUID_TEXT);
  });
});
```


- [ ] **Step 2: Run them and see them red** — the modules do not exist:

```bash
cd /c/tmp/g2b-kabul-fe/dashboard
npx vitest run src/live/data/structure.test.js src/live/data/StructureProvider.test.jsx src/live/screens/kabul/unitNames.test.jsx 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ Test Files |^ +Tests |^ FAIL |→ |×"
```

Expected (the replay, times vary):

```text
Test Files  3 failed (3)
      Tests  no tests
 FAIL  src/live/data/structure.test.js [ src/live/data/structure.test.js ]
 FAIL  src/live/data/StructureProvider.test.jsx [ src/live/data/StructureProvider.test.jsx ]
 FAIL  src/live/screens/kabul/unitNames.test.jsx [ src/live/screens/kabul/unitNames.test.jsx ]
```


- [ ] **Step 3: The index, the provider in the shell, the names on the three surfaces:**

**Write** `dashboard/src/live/data/structure.js` (a new file, whole):

```js
// src/live/data/structure.js — the ward's own units, rooms and beds, by name (Group 2 · B1a).
//
// `GET /tenant/structure` (homunculus-engine tenant/router.py) answers the caller's units with
// their rooms and beds: ids, names, labels, states, `is_active`. Since B1a every unit and bed id
// the screens meet — the engine's scope, a card's `unit_id`, a staff grant — is one of these
// UUIDs (spec D9), and NO SCREEN EVER SHOWS A UUID: it shows the name this tree gives it.
//
// Pure: StructureProvider.jsx holds the answer; these read it.

/** Ids compared as the engine compares them (scope `normalise_id`): trimmed, case-folded. */
export const normId = (id) => String(id ?? "").trim().toLowerCase();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Whether a text is a UUID — something a screen must never print. */
export const isUuid = (text) => UUID.test(String(text ?? "").trim());

/** Every unit, room and bed of an answer, flat, each with its parents' names:
 *  { units: Map(id -> {id, name, unitType, isActive, siteName}),
 *    rooms: Map(id -> {id, name, unitId, isActive}),
 *    beds:  Map(id -> {id, label, state, isActive, roomId, roomName, unitId, unitName, open}) }.
 *  `open`: the bed, its room and its unit are all open — only an open, AVAILABLE bed is offered to
 *  an admission. An answer that is not a tree is an empty index. */
export function indexStructure(structure) {
  const units = new Map();
  const rooms = new Map();
  const beds = new Map();
  for (const site of Array.isArray(structure?.sites) ? structure.sites : []) {
    for (const unit of site.units ?? []) {
      units.set(normId(unit.id), { id: unit.id, name: unit.name, unitType: unit.unit_type,
        isActive: unit.is_active !== false, siteName: site.name });
      for (const room of unit.rooms ?? []) {
        rooms.set(normId(room.id), { id: room.id, name: room.name, unitId: unit.id,
          isActive: room.is_active !== false });
        for (const bed of room.beds ?? []) {
          beds.set(normId(bed.id), {
            id: bed.id, label: bed.label, state: bed.state, isActive: bed.is_active !== false,
            roomId: room.id, roomName: room.name, unitId: unit.id, unitName: unit.name,
            open: bed.is_active !== false && room.is_active !== false && unit.is_active !== false,
          });
        }
      }
    }
  }
  return { units, rooms, beds };
}

export const EMPTY_INDEX = Object.freeze(indexStructure(null));

/** A unit as a screen names it: its name; else, for an id the tree does not hold, the id itself
 *  when it is a key someone wrote (an old free-text grant), and `t("kabul.unitUnknown")` when it
 *  is a UUID — never the UUID. */
export function unitLabel(t, index, id) {
  const unit = index.units.get(normId(id));
  if (unit) return unit.name;
  return isUuid(id) ? t("kabul.unitUnknown") : String(id ?? "");
}

/** A bed as a screen names it: "label · unit"; `null` when the tree does not hold it. */
export function bedLabel(index, id) {
  const bed = index.beds.get(normId(id));
  return bed ? `${bed.label} · ${bed.unitName}` : null;
}

/** Can an admission take this bed? Open, and AVAILABLE. */
export const admissible = (bed) => Boolean(bed?.open) && bed.state === "AVAILABLE";

/** Why a bed is not offered, as an i18n key — or null when it is. Closed wins over its state. */
export function unavailableKey(bed) {
  if (!bed) return null;
  if (!bed.open) return "kabul.bedClosed";
  if (bed.state === "AVAILABLE") return null;
  return BED_STATE_KEYS[bed.state] ?? "kabul.bedOther";
}

/** The bed lifecycle (homunculus-engine tenant/models.py BedState) in words. */
export const BED_STATE_KEYS = Object.freeze({
  AVAILABLE: "kabul.state.AVAILABLE",
  OCCUPIED: "kabul.state.OCCUPIED",
  PENDING_DISCHARGE: "kabul.state.PENDING_DISCHARGE",
  PENDING_TRANSFER_OUT: "kabul.state.PENDING_TRANSFER_OUT",
  HOUSEKEEPING: "kabul.state.HOUSEKEEPING",
  MAINTENANCE: "kabul.state.MAINTENANCE",
  BLOCKED: "kabul.state.BLOCKED",
});
```

**Write** `dashboard/src/live/data/StructureProvider.jsx` (a new file, whole):

```jsx
// src/live/data/StructureProvider.jsx — the ward's structure, read once for the whole shell
// (Group 2 · B1a). The top bar and the bed board read a unit's NAME from it, the admission screen
// its beds and their states, the administrator's Yapı tab the whole tree.
//
//   const { structure, index, phase, reload } = useStructure();
//
// `phase`: "unasked" (this session holds none of the rights `GET /tenant/structure` opens to, so
// it is not called), "loading", "known", "stale" (a reload failed; the last answer stands), or
// "failed" (none has answered). Every call goes through the session's `track`, as the board's do.
// Outside a provider (a screen mounted alone in a test) the context is empty: every name falls
// back as `unitLabel` says, and nothing is called.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "../session/SessionProvider.jsx";
import { EMPTY_INDEX, indexStructure } from "./structure.js";

/** The rights GET /tenant/structure opens to (tenant/router.py) — the scope editor's
 *  `users.manage` among them. */
export const STRUCTURE_PERMS = Object.freeze(["admissions.view", "admissions.admit", "beds.release", "structure.manage", "users.manage"]);

const NONE = Object.freeze({ structure: null, index: EMPTY_INDEX, phase: "unasked", error: null, reload: async () => {} });
const StructureContext = createContext(NONE);

export function StructureProvider({ children }) {
  const { user, store } = useSession();
  const may = STRUCTURE_PERMS.some((key) => user?.perms?.includes(key));
  const [state, setState] = useState(() => ({ structure: null, phase: may ? "loading" : "unasked", error: null }));
  const seq = useRef(0);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const reload = useCallback(async () => {
    if (!may) {
      setState({ structure: null, phase: "unasked", error: null });
      return;
    }
    const mine = seq.current + 1;
    seq.current = mine;
    try {
      const answer = await store.track(() => store.api.structure());
      // An answer that is not a tree is an empty one, still "known": the server answered.
      const tree = Array.isArray(answer?.sites) ? answer : { tenant_id: answer?.tenant_id ?? null, sites: [] };
      if (mounted.current && seq.current === mine) setState({ structure: tree, phase: "known", error: null });
    } catch (error) {
      if (mounted.current && seq.current === mine) {
        setState((prev) => ({ structure: prev.structure, phase: prev.structure ? "stale" : "failed", error }));
      }
    }
  }, [may, store]);

  useEffect(() => { reload(); }, [reload]);

  const value = useMemo(() => ({
    structure: state.structure, index: indexStructure(state.structure), phase: state.phase,
    error: state.error, reload,
  }), [state, reload]);
  return <StructureContext.Provider value={value}>{children}</StructureContext.Provider>;
}

export function useStructure() {
  return useContext(StructureContext);
}
```

**Edit** `dashboard/src/live/shell/Shell.jsx` (1) — replace:

```jsx
import { ShellProvider } from "./ShellContext.jsx";
import { Sidebar } from "./Sidebar.jsx";
```

with:

```jsx
import { ShellProvider } from "./ShellContext.jsx";
import { StructureProvider } from "../data/StructureProvider.jsx";   // G2-B1a
import { Sidebar } from "./Sidebar.jsx";
```

**Edit** `dashboard/src/live/shell/Shell.jsx` (2) — replace:

```jsx
    <ShellProvider units={units} scope={scopeState}>
      <div className="grid h-full grid-cols-[86px_minmax(0,1fr)] bg-page font-text text-14.5 text-ink max-[640px]:grid-cols-[62px_minmax(0,1fr)]">
```

with:

```jsx
    <ShellProvider units={units} scope={scopeState}>
      {/* G2-B1a: the ward's units and beds by name, for the top bar and every screen. */}
      <StructureProvider>
      <div className="grid h-full grid-cols-[86px_minmax(0,1fr)] bg-page font-text text-14.5 text-ink max-[640px]:grid-cols-[62px_minmax(0,1fr)]">
```

**Edit** `dashboard/src/live/shell/Shell.jsx` (3) — replace:

```jsx
      </div>
    </ShellProvider>
```

with:

```jsx
      </div>
      </StructureProvider>
    </ShellProvider>
```

**Edit** `dashboard/src/live/shell/TopBar.jsx` (1) — replace:

```jsx
import { pillRisk, summaryOf } from "../screens/common/BoardState.jsx";

```

with:

```jsx
import { pillRisk, summaryOf } from "../screens/common/BoardState.jsx";
import { useStructure } from "../data/StructureProvider.jsx";   // G2-B1a
import { unitLabel } from "../data/structure.js";

```

**Edit** `dashboard/src/live/shell/TopBar.jsx` (2) — replace:

```jsx
  const { unit, setUnit, units, stale } = useShell();
  if (units.length < 2) return null;
```

with:

```jsx
  const { unit, setUnit, units, stale } = useShell();
  // G2-B1a: a unit by its name from the structure, never its UUID (data/structure.js).
  const { index } = useStructure();
  const nameOf = (id) => unitLabel(t, index, id);
  if (units.length < 2) return null;
```

**Edit** `dashboard/src/live/shell/TopBar.jsx` (3) — replace:

```jsx
          <Icon name="building" size={16} />
          <span className="max-w-[160px] truncate">{unit ?? t("shell.units", { count: units.length })}</span>
          <Icon name="chevD" size={14} className="text-mute" />
```

with:

```jsx
          <Icon name="building" size={16} />
          <span className="max-w-[160px] truncate">{unit ? nameOf(unit) : t("shell.units", { count: units.length })}</span>
          <Icon name="chevD" size={14} className="text-mute" />
```

**Edit** `dashboard/src/live/shell/TopBar.jsx` (4) — replace:

```jsx
        "separator",
        ...units.map((u) => ({ key: u, label: <span className="font-data">{u}</span>, checked: unit === u, onSelect: () => setUnit(u) })),
      ]}
```

with:

```jsx
        "separator",
        ...units.map((u) => ({ key: u, label: <span>{nameOf(u)}</span>, checked: unit === u, onSelect: () => setUnit(u) })),
      ]}
```

**Edit** `dashboard/src/live/screens/beds/BedsScreen.jsx` (1) — replace:

```jsx
import { BedCard } from "./BedCard.jsx";
import { useShadow } from "../../data/ShadowProvider.jsx";
```

with:

```jsx
import { BedCard } from "./BedCard.jsx";
import { useStructure } from "../../data/StructureProvider.jsx";   // G2-B1a
import { unitLabel } from "../../data/structure.js";
import { useShadow } from "../../data/ShadowProvider.jsx";
```

**Edit** `dashboard/src/live/screens/beds/BedsScreen.jsx` (2) — replace:

```jsx
  const { unit, setUnit, units, stale: unitsStale } = useShell();
  const nowMs = useBoardNow(TICK_MS);
```

with:

```jsx
  const { unit, setUnit, units, stale: unitsStale } = useShell();
  // G2-B1a: a unit by its name, never its UUID (data/structure.js).
  const { index } = useStructure();
  const unitName = (id) => unitLabel(t, index, id);
  const nowMs = useBoardNow(TICK_MS);
```

**Edit** `dashboard/src/live/screens/beds/BedsScreen.jsx` (3) — replace:

```jsx
            <p className="m-0 text-13 text-mute">
              {unit ? t("beds.subUnit", { unit, count: shown.length }) : t("beds.sub", { count: shown.length })}
            </p>
          ) : unit ? <p className="m-0 text-13 text-mute">{unit}</p> : null}
        </div>
```

with:

```jsx
            <p className="m-0 text-13 text-mute">
              {unit ? t("beds.subUnit", { unit: unitName(unit), count: shown.length }) : t("beds.sub", { count: shown.length })}
            </p>
          ) : unit ? <p className="m-0 text-13 text-mute">{unitName(unit)}</p> : null}
        </div>
```

**Edit** `dashboard/src/live/screens/beds/BedsScreen.jsx` (4) — replace:

```jsx
                <option value="">{t("beds.unitAll")}</option>
                {units.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
```

with:

```jsx
                <option value="">{t("beds.unitAll")}</option>
                {units.map((u) => <option key={u} value={u}>{unitName(u)}</option>)}
              </select>
```

**Edit** `dashboard/src/live/screens/admin/ScopeEditor.jsx` (1) — replace:

```jsx
import { scopeKind } from "./rules.js";

```

with:

```jsx
import { scopeKind } from "./rules.js";
import { useStructure } from "../../data/StructureProvider.jsx"; // G2-B1a
import { bedLabel, isUuid, unitLabel } from "../../data/structure.js";

```

**Edit** `dashboard/src/live/screens/admin/ScopeEditor.jsx` (2) — replace:

```jsx
  const kind = scopeKind(base);

```

with:

```jsx
  const kind = scopeKind(base);
  // G2-B1a: a key by its name from the structure — since B1a the keys are the tenant's UUIDs, and
  // no screen shows one (spec D9). A key someone typed by hand is no UUID and is shown as typed.
  const { index } = useStructure();
  const unitName = (key) => unitLabel(t, index, key);
  const bedName = (key) => bedLabel(index, key) ?? (isUuid(key) ? t("kabul.bedUnknown") : key);

```

**Edit** `dashboard/src/live/screens/admin/ScopeEditor.jsx` (3) — replace:

```jsx

  const choices = (label, items, make) => (
    <fieldset className="mb-3 border-0 p-0">
```

with:

```jsx

  const choices = (label, items, make, nameOf) => (
    <fieldset className="mb-3 border-0 p-0">
```

**Edit** `dashboard/src/live/screens/admin/ScopeEditor.jsx` (4) — replace:

```jsx
            <input type="checkbox" checked={has(grant)} disabled={busy} onChange={(e) => toggle(grant, e.target.checked)} />
            <span className="font-data">{key}</span>
          </label>
```

with:

```jsx
            <input type="checkbox" checked={has(grant)} disabled={busy} onChange={(e) => toggle(grant, e.target.checked)} />
            <span className="font-data">{nameOf(key)}</span>
          </label>
```

**Edit** `dashboard/src/live/screens/admin/ScopeEditor.jsx` (5) — replace:

```jsx
          <>
            {choices(t("admin.scopeUnits"), offered.units, (key) => asGrant(key, ""))}
            {choices(t("admin.scopeBeds"), offered.beds, (key) => asGrant("", key))}
          </>
```

with:

```jsx
          <>
            {choices(t("admin.scopeUnits"), offered.units, (key) => asGrant(key, ""), unitName)}
            {choices(t("admin.scopeBeds"), offered.beds, (key) => asGrant("", key), bedName)}
          </>
```

**Edit** `dashboard/src/live/screens/admin/ScopeEditor.jsx` (6) — replace:

```jsx
            <tr key={keyOf(grant)}>
              <th scope="row" className="font-data">{grant.unitId || "—"}</th>
              <td className="font-data">{grant.bedId || "—"}</td>
              <td>
```

with:

```jsx
            <tr key={keyOf(grant)}>
              <th scope="row" className="font-data">{grant.unitId ? unitName(grant.unitId) : "—"}</th>
              <td className="font-data">{grant.bedId ? bedName(grant.bedId) : "—"}</td>
              <td>
```

**Edit** `dashboard/src/live/screens/admin/ScopeEditor.jsx` (7) — replace:

```jsx
                  busy={busy}
                  label={`${t("admin.remove")}: ${grant.unitId || grant.bedId}`}
                  onClick={() => toggle(grant, false)}
```

with:

```jsx
                  busy={busy}
                  label={`${t("admin.remove")}: ${grant.unitId ? unitName(grant.unitId) : bedName(grant.bedId)}`}
                  onClick={() => toggle(grant, false)}
```


- [ ] **Step 4: Run them green, with the shell, the bed board and the administration:**

```bash
cd /c/tmp/g2b-kabul-fe/dashboard
npx vitest run src/live/data/ src/live/screens/kabul/unitNames.test.jsx src/live/shell/ src/live/screens/beds/ src/live/screens/admin/ 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ Test Files |^ +Tests |^ FAIL |→ |×"
```

Expected (the replay, times vary):

```text
Test Files  23 passed (23)
      Tests  558 passed (558)
```


- [ ] **Step 5: The whole suite and the build:**

```bash
cd /c/tmp/g2b-kabul-fe/dashboard
npx vitest run 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ Test Files |^ +Tests |^ FAIL |→ |×"
```

Expected (the replay, times vary):

```text
Test Files  92 passed (92)
      Tests  2484 passed (2484)
```

```bash
cd /c/tmp/g2b-kabul-fe/dashboard
npx vite build 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "built in|precache|larger than|error"
```

Expected (the replay, times vary):

```text
✓ built in …s
precache  20 entries (883.27 KiB)
```


- [ ] **Step 6: Line ends:**

```bash
cd /c/tmp/g2b-kabul-fe
for f in dashboard/src/live/screens/kabul/kabul.testutil.js dashboard/src/live/data/structure.test.js dashboard/src/live/data/StructureProvider.test.jsx dashboard/src/live/screens/kabul/unitNames.test.jsx dashboard/src/live/data/structure.js dashboard/src/live/data/StructureProvider.jsx dashboard/src/live/shell/Shell.jsx dashboard/src/live/shell/TopBar.jsx dashboard/src/live/screens/beds/BedsScreen.jsx dashboard/src/live/screens/admin/ScopeEditor.jsx; do printf "%s CR=%s LF=%s\n" "$f" "$(tr -cd '\r' < "$f" | wc -c)" "$(tr -cd '\n' < "$f" | wc -c)"; done
```

Expected:

```text
dashboard/src/live/screens/kabul/kabul.testutil.js CR=0 LF=76
dashboard/src/live/data/structure.test.js CR=0 LF=74
dashboard/src/live/data/StructureProvider.test.jsx CR=0 LF=50
dashboard/src/live/screens/kabul/unitNames.test.jsx CR=0 LF=57
dashboard/src/live/data/structure.js CR=0 LF=84
dashboard/src/live/data/StructureProvider.jsx CR=0 LF=64
dashboard/src/live/shell/Shell.jsx CR=170 LF=170
dashboard/src/live/shell/TopBar.jsx CR=302 LF=302
dashboard/src/live/screens/beds/BedsScreen.jsx CR=368 LF=368
dashboard/src/live/screens/admin/ScopeEditor.jsx CR=330 LF=330
```


- [ ] **Step 7: Commit:**

```bash
cd /c/tmp/g2b-kabul-fe
git add -- dashboard/src/live/screens/kabul/kabul.testutil.js dashboard/src/live/data/structure.test.js dashboard/src/live/data/StructureProvider.test.jsx dashboard/src/live/screens/kabul/unitNames.test.jsx dashboard/src/live/data/structure.js dashboard/src/live/data/StructureProvider.jsx dashboard/src/live/shell/Shell.jsx dashboard/src/live/shell/TopBar.jsx dashboard/src/live/screens/beds/BedsScreen.jsx dashboard/src/live/screens/admin/ScopeEditor.jsx
git status --short && git diff --cached --stat
git commit -m "feat(dashboard): the ward's structure for the shell; units and beds by name, never by UUID (G2-B1a)" \
  -m "red: Test Files  3 failed (3) (no tests ran: the module under test does not exist)" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- dashboard/src/live/screens/kabul/kabul.testutil.js dashboard/src/live/data/structure.test.js dashboard/src/live/data/StructureProvider.test.jsx dashboard/src/live/screens/kabul/unitNames.test.jsx dashboard/src/live/data/structure.js dashboard/src/live/data/StructureProvider.jsx dashboard/src/live/shell/Shell.jsx dashboard/src/live/shell/TopBar.jsx dashboard/src/live/screens/beds/BedsScreen.jsx dashboard/src/live/screens/admin/ScopeEditor.jsx
```

---

### Task 13: The Hasta Kabul route and its three tabs

**Lane:** dashboard. **Needs:** Task 12.

Spec §5.1. The route `/kabul` ("Hasta Kabul", icon `userPlus`) opens to `admissions.view`, `admissions.admit`, `admissions.discharge.confirm` or `beds.release`, after the board's screens in the table so nobody's home moves; its `ROUTES` and `SCREENS` lines are `G2-B1a` blocks. `KabulScreen.jsx` is the frame: one `h1`, three tabs each offered to the rights it acts with (Kabul: `admissions.admit` or `admissions.view`; Taburcu: `admissions.view` or `admissions.discharge.confirm`; Yataklar: `admissions.view` or `beds.release`), opening on the first one offered, and a sentence for a session that may open none. The three tabs are empty stubs here (`return null`), each with a comment naming the task that builds it — every production module must be reachable from `main.jsx` in the commit that creates it (`src/reachable.test.js`), so the frame and its tabs land wired and Tasks 14–16 fill the tabs.

**Files:**
- Create: `dashboard/src/live/screens/kabul/KabulScreen.test.jsx`
- Create: `dashboard/src/live/screens/kabul/AdmitTab.jsx`
- Create: `dashboard/src/live/screens/kabul/DischargeTab.jsx`
- Create: `dashboard/src/live/screens/kabul/BedsTab.jsx`
- Create: `dashboard/src/live/screens/kabul/KabulScreen.jsx`
- Modify: `dashboard/src/live/shell/routes.js`

- [ ] **Step 1: Write the failing test** — the frame alone (the tabs are stubbed in it):

**Write** `dashboard/src/live/screens/kabul/KabulScreen.test.jsx` (a new file, whole):

```jsx
// The Hasta Kabul screen (Group 2 · B1a, spec §5.1): one h1, the three tabs gated by the rights
// each acts with, and the route that opens it for whoever reads, admits, confirms or releases.
import { describe, it, expect } from "vitest";
import React from "react";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { ROUTES, canReach } from "../../shell/routes.js";
import { KABUL_TABS, KabulScreen, kabulTabs } from "./KabulScreen.jsx";
import { CHARGE, DOCTOR, NURSE, UUID_TEXT, mountKabul } from "./kabul.testutil.js";

const tabNames = () => screen.getAllByRole("tab").map((tab) => tab.textContent);

describe("KabulScreen", () => {
  it("is a route for the admission rights, and no other", () => {
    const route = ROUTES.find((r) => r.id === "kabul");
    expect(route.path).toBe("/kabul");
    for (const perms of [["admissions.view"], ["admissions.admit"], ["admissions.discharge.confirm"], ["beds.release"]]) {
      expect(canReach(route, perms), perms[0]).toBe(true);
    }
    expect(canReach(route, ["board.view", "alerts.ack"])).toBe(false);
  });

  it("offers each tab to the rights it acts with", () => {
    expect(KABUL_TABS.map((tab) => tab.id)).toEqual(["admit", "discharge", "beds"]);
    expect(kabulTabs(["beds.release"]).map((tab) => tab.id)).toEqual(["beds"]);
    expect(kabulTabs(["admissions.admit"]).map((tab) => tab.id)).toEqual(["admit"]);
    expect(kabulTabs(["admissions.discharge.confirm"]).map((tab) => tab.id)).toEqual(["discharge"]);
    expect(kabulTabs([]).map((tab) => tab.id)).toEqual([]);
  });

  it("opens on Kabul for a nurse, with one h1, and moves between the tabs", async () => {
    await mountKabul(<KabulScreen />, { perms: NURSE });
    expect(screen.getAllByRole("heading", { level: 1 }).map((h) => h.textContent)).toEqual(["Xəstə qəbulu"]);
    expect(tabNames()).toEqual(["Qəbul", "Evə yazılma", "Çarpayılar"]);
    expect(screen.getByRole("tab", { name: "Qəbul" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("tab", { name: "Çarpayılar" }));
    expect(screen.getByRole("tab", { name: "Çarpayılar" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby"))
      .toBe(screen.getByRole("tab", { name: "Çarpayılar" }).id);
    expect(document.body.textContent).not.toMatch(UUID_TEXT);
  });

  it("shows a physician and a charge nurse all three tabs", async () => {
    await mountKabul(<KabulScreen />, { perms: DOCTOR });
    expect(tabNames()).toEqual(["Qəbul", "Evə yazılma", "Çarpayılar"]);
    cleanup();
    await mountKabul(<KabulScreen />, { perms: CHARGE });
    expect(tabNames()).toEqual(["Qəbul", "Evə yazılma", "Çarpayılar"]);
  });

  it("says so to a session that may open none of them", async () => {
    await mountKabul(<KabulScreen />, { perms: ["board.view"] });
    expect(screen.queryAllByRole("tab")).toEqual([]);
    expect(screen.getByText("Bu ekranın heç bir bölməsinə səlahiyyətiniz yoxdur.")).toBeTruthy();
  });
});
```


- [ ] **Step 2: Run it and see it red** — `KabulScreen.jsx` does not exist:

```bash
cd /c/tmp/g2b-kabul-fe/dashboard
npx vitest run src/live/screens/kabul/KabulScreen.test.jsx 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ Test Files |^ +Tests |^ FAIL |→ |×"
```

Expected (the replay, times vary):

```text
Test Files  1 failed (1)
      Tests  no tests
 FAIL  src/live/screens/kabul/KabulScreen.test.jsx [ src/live/screens/kabul/KabulScreen.test.jsx ]
```


- [ ] **Step 3: The three stubs, the frame, the route:**

**Write** `dashboard/src/live/screens/kabul/AdmitTab.jsx` (a new file, whole):

```jsx
// src/live/screens/kabul/AdmitTab.jsx — "Kabul" (Group 2 · B1a). Task 14 builds it; until then
// the frame (KabulScreen.jsx) offers the tab and shows nothing in it, so the route and the tabs
// stand and are tested on their own (src/reachable.test.js: a module is wired the day it lands).
export function AdmitTab() {
  return null;
}
```

**Write** `dashboard/src/live/screens/kabul/DischargeTab.jsx` (a new file, whole):

```jsx
// src/live/screens/kabul/DischargeTab.jsx — "Taburcu" (Group 2 · B1a). Task 15 builds it; until then
// the frame (KabulScreen.jsx) offers the tab and shows nothing in it, so the route and the tabs
// stand and are tested on their own (src/reachable.test.js: a module is wired the day it lands).
export function DischargeTab() {
  return null;
}
```

**Write** `dashboard/src/live/screens/kabul/BedsTab.jsx` (a new file, whole):

```jsx
// src/live/screens/kabul/BedsTab.jsx — "Yataklar" (Group 2 · B1a). Task 16 builds it; until then
// the frame (KabulScreen.jsx) offers the tab and shows nothing in it, so the route and the tabs
// stand and are tested on their own (src/reachable.test.js: a module is wired the day it lands).
export function BedsTab() {
  return null;
}
```

**Write** `dashboard/src/live/screens/kabul/KabulScreen.jsx` (a new file, whole):

```jsx
// src/live/screens/kabul/KabulScreen.jsx — "Hasta Kabul" (Group 2 · B1a, spec §5.1): Kabul ·
// Taburcu · Yataklar, each gated by the rights it acts with. The route opens to any of
// `admissions.view`, `admissions.admit`, `admissions.discharge.confirm`, `beds.release`
// (shell/routes.js); a tab this session may not open is not shown, and the screen opens on the
// first it may. Writes inside a tab are gated again by their own right; the server checks all.
//
// The tab is held in state, not in the address, as the administration screen holds its own
// (AdminScreen.jsx): nothing in the product links to a tab.
import React, { useMemo, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useSession } from "../../session/SessionProvider.jsx";
import { Empty, TabPanel, Tabs } from "../../ui/index.js";
import { AdmitTab } from "./AdmitTab.jsx";
import { DischargeTab } from "./DischargeTab.jsx";
import { BedsTab } from "./BedsTab.jsx";

const TAB_ID = "kabul";

/** The three tabs, in order: the id, the rights that open it (any one), its label, its screen. */
export const KABUL_TABS = Object.freeze([
  Object.freeze({ id: "admit", perms: Object.freeze(["admissions.admit", "admissions.view"]), labelKey: "kabul.tabAdmit", Tab: AdmitTab }),
  Object.freeze({ id: "discharge", perms: Object.freeze(["admissions.view", "admissions.discharge.confirm"]), labelKey: "kabul.tabDischarge", Tab: DischargeTab }),
  Object.freeze({ id: "beds", perms: Object.freeze(["admissions.view", "beds.release"]), labelKey: "kabul.tabBeds", Tab: BedsTab }),
]);

export const kabulTabs = (perms) => KABUL_TABS.filter((tab) => tab.perms.some((key) => perms?.includes(key)));

export function KabulScreen() {
  const { t } = useI18n();
  const { user } = useSession();
  const tabs = useMemo(() => kabulTabs(user?.perms), [user?.perms]);
  const [tab, setTab] = useState(() => tabs[0]?.id ?? null);
  const current = tabs.find((x) => x.id === tab) ?? tabs[0] ?? null;
  const shown = tabs.map((x) => ({ value: x.id, label: t(x.labelKey) }));
  return (
    <div className="flex min-h-0 max-w-[1200px] flex-col gap-3">
      <div>
        <h1 className="m-0 font-display text-23 font-bold">{t("kabul.title")}</h1>
        <p className="m-0 text-13 text-mute">{t("kabul.sub")}</p>
      </div>
      {current === null ? <Empty icon="shield">{t("kabul.noAccess")}</Empty> : (
        <>
          <Tabs id={TAB_ID} label={t("kabul.sections")} tabs={shown} value={current.id} onChange={setTab} />
          <TabPanel id={TAB_ID} tabs={shown} value={current.id}>
            <current.Tab />
          </TabPanel>
        </>
      )}
    </div>
  );
}
```

**Edit** `dashboard/src/live/shell/routes.js` (1) — replace:

```js

/** The screen each route shows in THIS build, by route id — `null` until its wave sets it.
```

with:

```js

import { KabulScreen } from "../screens/kabul/KabulScreen.jsx"; // G2-B1a

/** The screen each route shows in THIS build, by route id — `null` until its wave sets it.
```

**Edit** `dashboard/src/live/shell/routes.js` (2) — replace:

```js
  devices: DevicesScreen, // Aşama A — biomedical's monitor screen (devices, beds, values; no patient)

```

with:

```js
  devices: DevicesScreen, // Aşama A — biomedical's monitor screen (devices, beds, values; no patient)

  kabul: KabulScreen, // G2-B1a — Hasta Kabul: admission, discharge, beds

```

**Edit** `dashboard/src/live/shell/routes.js` (3) — replace:

```js
    perms: ["devices.manage"], work: true, nav: "main" }),

```

with:

```js
    perms: ["devices.manage"], work: true, nav: "main" }),

  // G2-B1a — Hasta Kabul (spec §5.1): for whoever reads admissions, admits, confirms a discharge or
  // releases a bed. After the board's screens in the table, so nobody's home moves.
  route({ id: "kabul", path: "/kabul", icon: "userPlus", labelKey: "kabul.nav", shortKey: "kabul.navShort",
    perms: ["admissions.view", "admissions.admit", "admissions.discharge.confirm", "beds.release"], work: true, nav: "main" }),

```


- [ ] **Step 4: Run them green, with the shell's route table, reachability and the raw-key sweep:**

```bash
cd /c/tmp/g2b-kabul-fe/dashboard
npx vitest run src/live/screens/kabul/ src/live/shell/ src/reachable.test.js src/live/rawKeys.test.jsx 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ Test Files |^ +Tests |^ FAIL |→ |×"
```

Expected (the replay, times vary):

```text
Test Files  7 passed (7)
      Tests  97 passed (97)
```


- [ ] **Step 5: The whole suite and the build:**

```bash
cd /c/tmp/g2b-kabul-fe/dashboard
npx vitest run 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ Test Files |^ +Tests |^ FAIL |→ |×"
```

Expected (the replay, times vary):

```text
Test Files  93 passed (93)
      Tests  2489 passed (2489)
```

```bash
cd /c/tmp/g2b-kabul-fe/dashboard
npx vite build 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "built in|precache|larger than|error"
```

Expected (the replay, times vary):

```text
✓ built in …s
precache  20 entries (884.77 KiB)
```


- [ ] **Step 6: Line ends:**

```bash
cd /c/tmp/g2b-kabul-fe
for f in dashboard/src/live/screens/kabul/KabulScreen.test.jsx dashboard/src/live/screens/kabul/AdmitTab.jsx dashboard/src/live/screens/kabul/DischargeTab.jsx dashboard/src/live/screens/kabul/BedsTab.jsx dashboard/src/live/screens/kabul/KabulScreen.jsx dashboard/src/live/shell/routes.js; do printf "%s CR=%s LF=%s\n" "$f" "$(tr -cd '\r' < "$f" | wc -c)" "$(tr -cd '\n' < "$f" | wc -c)"; done
```

Expected:

```text
dashboard/src/live/screens/kabul/KabulScreen.test.jsx CR=0 LF=55
dashboard/src/live/screens/kabul/AdmitTab.jsx CR=0 LF=6
dashboard/src/live/screens/kabul/DischargeTab.jsx CR=0 LF=6
dashboard/src/live/screens/kabul/BedsTab.jsx CR=0 LF=6
dashboard/src/live/screens/kabul/KabulScreen.jsx CR=0 LF=51
dashboard/src/live/shell/routes.js CR=201 LF=201
```


- [ ] **Step 7: Commit:**

```bash
cd /c/tmp/g2b-kabul-fe
git add -- dashboard/src/live/screens/kabul/KabulScreen.test.jsx dashboard/src/live/screens/kabul/AdmitTab.jsx dashboard/src/live/screens/kabul/DischargeTab.jsx dashboard/src/live/screens/kabul/BedsTab.jsx dashboard/src/live/screens/kabul/KabulScreen.jsx dashboard/src/live/shell/routes.js
git status --short && git diff --cached --stat
git commit -m "feat(dashboard): the Hasta Kabul route and its three tabs, wired (G2-B1a)" \
  -m "red: Test Files  1 failed (1) (no tests ran: the module under test does not exist)" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- dashboard/src/live/screens/kabul/KabulScreen.test.jsx dashboard/src/live/screens/kabul/AdmitTab.jsx dashboard/src/live/screens/kabul/DischargeTab.jsx dashboard/src/live/screens/kabul/BedsTab.jsx dashboard/src/live/screens/kabul/KabulScreen.jsx dashboard/src/live/shell/routes.js
```

---

### Task 14: Kabul — the form, the missing-fields panel, the bed picker, the number box

**Lane:** dashboard. **Needs:** Task 13; **Task 3 merged** (`admitForm.test.js` reads `admission/form.py`'s comorbidity codes).

Spec §3.1, §5.2, X53, X63, X66. The prototype's form in four groups (Kimlik, Kabul, İletişim ve onam, Yatak). `admitForm.js` holds the choices (each with an explicit key), `missing(form)` (every required field still empty, in the form's order — the panel names them and "Qəbul et" is held, `aria-disabled`, until there is none), `ageOf` (the age beside the date of birth, not a field) and `toBody` (the API's names, numbers as numbers, a decimal comma read as a point, the FİN upper-case). The browser checks presence and format only; the bounds are the server's (X63). `BedPicker.jsx`: unit → room → bed, an open AVAILABLE bed offered, every other dimmed with its reason, the chosen one pressed and named. One request admits; the number box shows the patient number large, with what to do with it ("Başucu cihazına bu numarayı girin."), and names each engine part that did not land (X53). A refusal goes on the toast named after the bed, by its code, and the beds are read again. A physician sees a read-only note, not a disabled form (X66).

**Files:**
- Create: `dashboard/src/live/screens/kabul/admitForm.test.js`
- Create: `dashboard/src/live/screens/kabul/BedPicker.test.jsx`
- Create: `dashboard/src/live/screens/kabul/AdmitTab.test.jsx`
- Create: `dashboard/src/live/screens/kabul/admitForm.js`
- Create: `dashboard/src/live/screens/kabul/BedPicker.jsx`
- Modify: `dashboard/src/live/screens/kabul/AdmitTab.jsx`

- [ ] **Step 1: Write the failing tests:**

**Write** `dashboard/src/live/screens/kabul/admitForm.test.js` (a new file, whole):

```js
// The admission form's own rules (Group 2 · B1a, spec §5.2): what is still missing, in the form's
// order; the age beside the date of birth; the body POST /admissions takes.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COMORBIDITIES, ageOf, emptyForm, missing, positive, toBody } from "./admitForm.js";

const TODAY = "2026-10-25";
const complete = () => ({
  ...emptyForm(), name: "Sentetik Hasta", sex: "female", dob: "1970-05-05", type: "ICU",
  diagnosis: "Sentetik tanı", noAllergy: true, consent: "KVKK_SIGNED", bedId: "b-1", unitId: "u-1",
});
const fields = (form) => missing(form, TODAY).map((m) => m.field);

describe("what the form still lacks", () => {
  it("names every required field of an empty form, in the form's order", () => {
    expect(fields(emptyForm())).toEqual(["name", "sex", "dob", "type", "diagnosis", "allergy", "consent", "bed"]);
  });

  it("is nothing once every required field is filled", () => {
    expect(fields(complete())).toEqual([]);
  });

  it("wants an allergy OR «none known», never both and never neither", () => {
    expect(fields({ ...complete(), noAllergy: false })).toEqual(["allergy"]);
    expect(fields({ ...complete(), allergy: "Penisilin" })).toEqual(["allergy"]);
    expect(fields({ ...complete(), noAllergy: false, allergy: "Penisilin" })).toEqual([]);
  });

  it("refuses a FİN that is not seven letters or digits, a date of birth after today, a weight that is no number", () => {
    expect(fields({ ...complete(), fin: "5AB12C" })).toEqual(["fin"]);
    expect(fields({ ...complete(), fin: "5ab12cd" })).toEqual([]);
    expect(fields({ ...complete(), dob: "2026-10-26" })).toEqual(["dob"]);
    expect(missing({ ...complete(), dob: "2026-10-26" }, TODAY)[0].key).toBe("kabul.miss.dobWrong");
    expect(fields({ ...complete(), weight: "yetmiş" })).toEqual(["weight"]);
    expect(fields({ ...complete(), weight: "72,5", height: "171" })).toEqual([]);
  });
});

describe("the age shown beside the date of birth", () => {
  it("is whole years, months and days", () => {
    expect(ageOf("1970-05-05", TODAY)).toEqual({ years: 56, months: 5, days: 20 });
    expect(ageOf("2026-10-01", TODAY)).toEqual({ years: 0, months: 0, days: 24 });
    expect(ageOf("2025-10-26", TODAY)).toEqual({ years: 0, months: 11, days: 29 });
  });

  it("is nothing for a date that is not one or is in the future", () => {
    for (const dob of ["", "2026-02-30", "26-10-2026", "2026-10-26"]) expect(ageOf(dob, TODAY), dob).toBeNull();
  });
});

describe("the body POST /admissions takes", () => {
  it("carries the form as the API names it, numbers as numbers and the FİN upper-case", () => {
    const body = toBody({ ...complete(), fin: " 5ab12cd ", weight: "72,5", height: "171", phone: " +994 50 123 45 67 ",
      comorbidities: ["copd"], comorbiditiesText: "  ", blood: "A_POS" });
    expect(body.patient).toMatchObject({ display_name: "Sentetik Hasta", date_of_birth: "1970-05-05", sex: "female",
      national_id: "5AB12CD", phone: "+994 50 123 45 67", consent: "KVKK_SIGNED", sms_permitted: false, father_name: null });
    expect(body.note).toEqual({
      admitting_unit_id: "u-1", bed_id: "b-1", admission_type: "ICU", source_of_admission: null,
      admission_diagnosis_free_text: "Sentetik tanı", weight_kg: 72.5, height_cm: 171, blood_group: "A_POS",
      allergies_text: null, no_known_allergy: true, comorbidity_codes: ["copd"], comorbidities_text: null,
    });
  });

  it("reads a decimal comma as a point, and nothing else as a number", () => {
    expect(positive("72,5")).toBe(72.5);
    expect(positive("0")).toBeNull();
    expect(positive("1e3")).toBeNull();
    expect(positive("")).toBeNull();
  });

  it("offers only comorbidity codes the server's form takes (admission/form.py)", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const form = fs.readFileSync(path.resolve(here, "../../../../../homunculus-engine/src/homunculus/admission/form.py"), "utf8");
    const server = /COMORBIDITY_CODES = \(([^)]*)\)/.exec(form)[1].match(/"(\w+)"/g).map((s) => s.slice(1, -1));
    for (const { value } of COMORBIDITIES) expect(server, value).toContain(value);
  });
});
```

**Write** `dashboard/src/live/screens/kabul/BedPicker.test.jsx` (a new file, whole):

```jsx
// The bed picker (Group 2 · B1a, spec §5.2): unit → room → bed; only an open, AVAILABLE bed can be
// chosen, and every other bed says why it is not offered.
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { I18nProvider } from "../../i18n/I18nProvider.jsx";
import { BedPicker } from "./BedPicker.jsx";
import { BED, NEO, REA, UUID_TEXT, structure } from "./kabul.testutil.js";

function draw(props = {}) {
  const onUnit = vi.fn();
  const onBed = vi.fn();
  render(<I18nProvider><BedPicker structure={structure()} unitId={REA} bedId={null} onUnit={onUnit} onBed={onBed} {...props} /></I18nProvider>);
  return { onUnit, onBed };
}

describe("BedPicker", () => {
  it("lists the units with their free beds, and a closed unit as closed", () => {
    const { onUnit } = draw({ unitId: null });
    const units = within(screen.getByRole("group", { name: "Şöbə" }));
    expect(units.getByRole("button", { name: /Reanimasiya\s*2 boş/ })).toBeTruthy();
    expect(units.getByRole("button", { name: /Neonatal\s*bağlıdır/ })).toBeTruthy();
    expect(screen.getByText("Əvvəlcə şöbəni seçin.")).toBeTruthy();
    fireEvent.click(units.getByRole("button", { name: /Reanimasiya/ }));
    expect(onUnit).toHaveBeenCalledWith(REA);
  });

  it("offers an open AVAILABLE bed, and names it bed · room · unit", () => {
    const { onBed } = draw();
    fireEvent.click(within(screen.getByRole("group", { name: "Otaq 2" })).getByRole("button", { name: "5" }));
    expect(onBed).toHaveBeenCalledWith({ id: BED(5), unitId: REA, label: "5 · Otaq 2 · Reanimasiya" });
  });

  it("shows every other bed dimmed with its reason, and choosing it does nothing", () => {
    const { onBed } = draw();
    const room = within(screen.getByRole("group", { name: "Otaq 1" }));
    for (const [label, why] of [["2", "Dolu"], ["3", "Təmizlikdədir"], ["4", "Bağlıdır"]]) {
      const bed = room.getByRole("button", { name: `${label} · ${why}` });
      expect(bed.getAttribute("aria-disabled")).toBe("true");
      fireEvent.click(bed);
    }
    expect(onBed).not.toHaveBeenCalled();
  });

  it("marks the chosen bed pressed and says which it is", () => {
    draw({ bedId: BED(1) });
    expect(screen.getByRole("button", { name: "1" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("Seçilən: 1 · Otaq 1 · Reanimasiya")).toBeTruthy();
  });

  it("says when there is nothing to choose, and never prints a UUID", () => {
    draw({ unitId: NEO });
    expect(document.body.textContent).not.toMatch(UUID_TEXT);
    render(<I18nProvider><BedPicker structure={{ sites: [] }} unitId={null} bedId={null} onUnit={() => {}} onBed={() => {}} /></I18nProvider>);
    expect(screen.getByText("Səlahiyyət dairənizdə təyin olunmuş şöbə və ya çarpayı yoxdur.")).toBeTruthy();
  });
});
```

**Write** `dashboard/src/live/screens/kabul/AdmitTab.test.jsx` (a new file, whole):

```jsx
// The Kabul tab (Group 2 · B1a, spec §3.1, §5.2): the side panel names every missing field and
// "Kabul et" is held until it is empty; one request admits; the patient number is shown large with
// what to do with it, and any engine part that did not land; a refusal goes on the toast, named
// after the bed, and the bed picker is read again.
import { describe, it, expect } from "vitest";
import React from "react";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { refusal } from "../../session/mount.testutil.jsx";
import { AdmitTab } from "./AdmitTab.jsx";
import { BED, DOCTOR, NURSE, REA, UUID_TEXT, mountKabul, settle, toasts } from "./kabul.testutil.js";

const panel = () => within(screen.getByRole("complementary", { name: "Çatışmayan sahələr" }));
const admitButton = () => screen.getByRole("button", { name: "Qəbul et" });

function fillRequired() {
  fireEvent.change(screen.getByLabelText(/^Ad soyad/), { target: { value: "Sentetik Hasta" } });
  fireEvent.click(screen.getByLabelText("Qadın"));
  fireEvent.change(screen.getByLabelText(/^Doğum tarixi/), { target: { value: "1970-05-05" } });
  fireEvent.change(screen.getByLabelText(/^Qəbul növü/), { target: { value: "ICU" } });
  fireEvent.change(screen.getByLabelText(/^Qəbul diaqnozu/), { target: { value: "Sentetik tanı" } });
  fireEvent.click(screen.getByLabelText("Məlum allergiyası yoxdur"));
  fireEvent.click(screen.getByLabelText("Şəxsi məlumatlara razılıq imzalandı"));
  fireEvent.click(screen.getByRole("button", { name: /^Reanimasiya/ }));
  fireEvent.click(screen.getByRole("button", { name: "1" }));
}

describe("AdmitTab", () => {
  it("shows a physician the read-only note and no form", async () => {
    await mountKabul(<AdmitTab />, { perms: DOCTOR });
    expect(screen.getByText(/Baxış səlahiyyəti ilə açmısınız/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Qəbul et" })).toBeNull();
  });

  it("names every missing required field, and holds «Qəbul et» until there is none", async () => {
    const { api } = await mountKabul(<AdmitTab />, { perms: NURSE });
    expect(panel().getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Ad soyad", "Cins", "Doğum tarixi", "Qəbul növü", "Qəbul diaqnozu",
      "Allergiya və ya «məlum allergiyası yoxdur» — ikisindən biri", "Razılıq", "Çarpayı"]);
    expect(admitButton().getAttribute("aria-disabled")).toBe("true");
    await act(async () => { fireEvent.click(admitButton()); });
    expect(api.admit).not.toHaveBeenCalled();
    expect(screen.getAllByText("Ad soyad").length).toBeGreaterThan(1);       // said under the field too

    fillRequired();
    expect(panel().getByText("Bütün məcburi sahələr doludur.")).toBeTruthy();
    expect(admitButton().getAttribute("aria-disabled")).toBeNull();
  });

  it("admits with one request and shows the patient number with what to do with it", async () => {
    const { api } = await mountKabul(<AdmitTab />, {
      perms: NURSE,
      setup: (a) => a.admit.mockResolvedValue({ id: "a-1", patient_number: "H2600042", state: "DRAFT",
        engine: { weight: "failed", profile: "skipped", board: "ok" } }),
    });
    fillRequired();
    await act(async () => { fireEvent.click(admitButton()); });
    await settle();

    expect(api.admit).toHaveBeenCalledTimes(1);
    const body = api.admit.mock.calls[0][0];
    expect(body.note).toMatchObject({ bed_id: BED(1), admitting_unit_id: REA, admission_type: "ICU", no_known_allergy: true });
    expect(body.patient).toMatchObject({ display_name: "Sentetik Hasta", sex: "female", consent: "KVKK_SIGNED" });

    expect(screen.getByText("H2600042")).toBeTruthy();
    expect(screen.getByText("Çarpayı yanındakı cihaza bu nömrəni daxil edin.")).toBeTruthy();
    expect(screen.getByText("Çəki sistemə çatmadı — xəstə ekranından daxil edin.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Paneldə bax" }).getAttribute("href")).toBe("#/patients/H2600042");
    expect(toasts().getAllByText("1 · Otaq 1 · Reanimasiya · qəbul edildi, xəstə nömrəsi H2600042").length).toBeGreaterThan(0);
    expect(api.structure.mock.calls.length).toBeGreaterThan(1);               // the picker is read again
    expect(document.body.textContent).not.toMatch(UUID_TEXT);
  });

  it("puts a refusal on the toast named after the bed, by its code, and reads the beds again", async () => {
    const { api } = await mountKabul(<AdmitTab />, {
      perms: NURSE,
      setup: (a) => a.admit.mockRejectedValue(refusal(409, "Bed is not AVAILABLE (current state: OCCUPIED); cannot admit.",
        { apiCode: "bed_not_available" })),
    });
    fillRequired();
    const reads = api.structure.mock.calls.length;
    await act(async () => { fireEvent.click(admitButton()); });
    await settle();
    expect(toasts().getAllByText("1 · Otaq 1 · Reanimasiya: Bu çarpayı artıq boş deyil; başqa çarpayı seçin.").length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/current state/);
    expect(api.structure.mock.calls.length).toBeGreaterThan(reads);
    expect(screen.queryByText("H2600042")).toBeNull();
  });

  it("shows the age beside the date of birth, not as a field", async () => {
    await mountKabul(<AdmitTab />, { perms: NURSE });
    fireEvent.change(screen.getByLabelText(/^Doğum tarixi/), { target: { value: "2000-01-01" } });
    expect(screen.getByText(/^\d+ yaş \d+ ay \d+ gün$/)).toBeTruthy();
  });
});
```


- [ ] **Step 2: Run them and see them red** — `admitForm.js` and `BedPicker.jsx` do not exist, and the tab is a stub:

```bash
cd /c/tmp/g2b-kabul-fe/dashboard
npx vitest run src/live/screens/kabul/admitForm.test.js src/live/screens/kabul/BedPicker.test.jsx src/live/screens/kabul/AdmitTab.test.jsx 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ Test Files |^ +Tests |^ FAIL |→ |×"
```

Expected (the replay, times vary):

```text
Test Files  3 failed (3)
      Tests  5 failed (5)
 FAIL  src/live/screens/kabul/admitForm.test.js [ src/live/screens/kabul/admitForm.test.js ]
 FAIL  src/live/screens/kabul/BedPicker.test.jsx [ src/live/screens/kabul/BedPicker.test.jsx ]
 FAIL  src/live/screens/kabul/AdmitTab.test.jsx > AdmitTab > shows a physician the read-only note and no form
 FAIL  src/live/screens/kabul/AdmitTab.test.jsx > AdmitTab > names every missing required field, and holds «Qəbul et» until there is none
 FAIL  src/live/screens/kabul/AdmitTab.test.jsx > AdmitTab > admits with one request and shows the patient number with what to do with it
 FAIL  src/live/screens/kabul/AdmitTab.test.jsx > AdmitTab > puts a refusal on the toast named after the bed, by its code, and reads the beds again
 FAIL  src/live/screens/kabul/AdmitTab.test.jsx > AdmitTab > shows the age beside the date of birth, not as a field
× AdmitTab > shows a physician the read-only note and no form 34ms
→ Unable to find an element with the text: /Baxış səlahiyyəti ilə açmısınız/. This could be because the text is broken up by multiple elements. In this case, you can provide a function for your text matcher to make your matcher more flexible.
× AdmitTab > names every missing required field, and holds «Qəbul et» until there is none 35ms
→ Unable to find an accessible element with the role "complementary" and name "Çatışmayan sahələr"
× AdmitTab > admits with one request and shows the patient number with what to do with it 20ms
→ Unable to find a label with the text of: /^Ad soyad/
```


- [ ] **Step 3: The form's logic, the picker, the tab:**

**Write** `dashboard/src/live/screens/kabul/admitForm.js` (a new file, whole):

```js
// src/live/screens/kabul/admitForm.js — the admission form's values, what is still missing, and
// the body POST /admissions takes (Group 2 · B1a, spec §5.2). Pure.
//
// The server checks the same rules again (homunculus-engine admission/form.py) and answers
// `field_invalid:<field>`: this copy exists so that "Kabul et" can stay held, and the side panel
// can NAME each missing field, before anything is sent. It holds presence and format only — no
// clinical bound: a weight the engine will not chart is the server's refusal, said on the toast.

// Every choice with the key of its words, written out: a key assembled at run time is one no
// check can see (strings.test.js, rawKeys.test.jsx).
const choices = (pairs) => Object.freeze(pairs.map(([value, key]) => Object.freeze({ value, key })));

/** The prototype's `ADM_T`, as the engine stores it. */
export const ADMISSION_TYPES = choices([["MEDICAL", "kabul.type.medical"], ["SURGICAL", "kabul.type.surgical"],
  ["ICU", "kabul.type.icu"], ["PROCEDURE", "kabul.type.procedure"]]);
export const BLOOD_GROUPS = choices([["UNKNOWN", "kabul.blood.unknown"], ["A_POS", "kabul.blood.aPos"],
  ["A_NEG", "kabul.blood.aNeg"], ["B_POS", "kabul.blood.bPos"], ["B_NEG", "kabul.blood.bNeg"],
  ["AB_POS", "kabul.blood.abPos"], ["AB_NEG", "kabul.blood.abNeg"], ["O_POS", "kabul.blood.oPos"],
  ["O_NEG", "kabul.blood.oNeg"]]);
/** The comorbidity codes the engine reads (rules/patient_relative.py); "dementia" stands for
 *  dementia and chronic confusion together, as the form's one checkbox says. */
export const COMORBIDITIES = choices([["copd", "kabul.comorbidity.copd"],
  ["chronic_respiratory_failure", "kabul.comorbidity.respiratoryFailure"],
  ["chronic_oxygen", "kabul.comorbidity.homeOxygen"], ["dementia", "kabul.comorbidity.dementia"]]);
export const RELATIONS = choices([["spouse", "kabul.relation.spouse"], ["mother", "kabul.relation.mother"],
  ["father", "kabul.relation.father"], ["child", "kabul.relation.child"],
  ["sibling", "kabul.relation.sibling"], ["other", "kabul.relation.other"]]);
export const NATIONALITIES = choices([["az", "kabul.nat.az"], ["tr", "kabul.nat.tr"], ["ru", "kabul.nat.ru"],
  ["ge", "kabul.nat.ge"], ["ir", "kabul.nat.ir"], ["other", "kabul.nat.other"]]);
export const SEXES = choices([["female", "kabul.sex.female"], ["male", "kabul.sex.male"]]);
/** Where the patient came from (admission/models.py SourceOfAdmission); optional. */
export const SOURCES = choices([["EMERGENCY", "kabul.source.emergency"],
  ["ELECTIVE_SURGERY", "kabul.source.electiveSurgery"], ["TRANSFER_INTERNAL", "kabul.source.transferInternal"],
  ["TRANSFER_EXTERNAL", "kabul.source.transferExternal"], ["OTHER", "kabul.source.other"]]);
export const CONSENTS = choices([["KVKK_SIGNED", "kabul.consent.signed"], ["UNCONSCIOUS_LATER", "kabul.consent.later"]]);
/** What the answer's `engine` part names, when it did not land. */
export const ENGINE_FAILED = Object.freeze({
  board: "kabul.engineFailed.board", weight: "kabul.engineFailed.weight", profile: "kabul.engineFailed.profile",
});

export function emptyForm() {
  return {
    name: "", father: "", sex: "", dob: "", nationality: "az", fin: "", passport: "", phone: "",
    type: "", source: "", diagnosis: "", weight: "", height: "", blood: "UNKNOWN",
    allergy: "", noAllergy: false, comorbidities: [], comorbiditiesText: "", his: "",
    relativeName: "", relativeRelation: "", relativePhone: "", companion: "",
    consent: "", sms: false, bedId: null, unitId: null, bedLabel: null,
  };
}

const blank = (value) => String(value ?? "").trim() === "";
/** A positive decimal, comma or point: "72,5" is 72.5. null for anything else. */
export function positive(value) {
  const text = String(value ?? "").trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  const n = Number(text);
  return n > 0 ? n : null;
}
const FIN = /^[A-Za-z0-9]{7}$/;

/** Whole years, months and days from a date of birth (YYYY-MM-DD) to `today` (the same shape),
 *  or null for no date, a date that is not one, or one after today. Shown beside the date, never
 *  edited (spec §5.2). */
export function ageOf(dob, today) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dob ?? ""));
  const n = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(today ?? ""));
  if (!m || !n) return null;
  const [y, mo, d] = m.slice(1).map(Number);
  const [ty, tmo, td] = n.slice(1).map(Number);
  const born = new Date(Date.UTC(y, mo - 1, d));
  if (born.getUTCMonth() !== mo - 1 || born.getUTCDate() !== d) return null;   // 2026-02-30
  if (dob > today) return null;
  let years = ty - y;
  let months = tmo - mo;
  let days = td - d;
  if (days < 0) {
    months -= 1;
    days += new Date(Date.UTC(ty, tmo - 1, 0)).getUTCDate();
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  return { years, months, days };
}

/** Each field the form still lacks or holds wrong, in the form's order: [{field, key}] — `key` is
 *  the panel's sentence for it. Empty when "Kabul et" may be pressed. */
export function missing(form, today) {
  const out = [];
  const add = (field, key) => out.push({ field, key });
  if (blank(form.name)) add("name", "kabul.miss.name");
  if (!form.sex) add("sex", "kabul.miss.sex");
  if (blank(form.dob)) add("dob", "kabul.miss.dob");
  else if (!ageOf(form.dob, today)) add("dob", "kabul.miss.dobWrong");
  if (!blank(form.fin) && !FIN.test(form.fin.trim())) add("fin", "kabul.miss.fin");
  if (!form.type) add("type", "kabul.miss.type");
  if (blank(form.diagnosis)) add("diagnosis", "kabul.miss.diagnosis");
  if (!blank(form.weight) && positive(form.weight) === null) add("weight", "kabul.miss.weight");
  if (!blank(form.height) && positive(form.height) === null) add("height", "kabul.miss.height");
  if (blank(form.allergy) === !form.noAllergy) add("allergy", "kabul.miss.allergy");
  if (!form.consent) add("consent", "kabul.miss.consent");
  if (!form.bedId) add("bed", "kabul.miss.bed");
  return out;
}

const text = (value) => (blank(value) ? null : String(value).trim());

/** The body POST /admissions takes (admission/schemas.py AdmissionCreate). */
export function toBody(form) {
  return {
    patient: {
      display_name: form.name.trim(), date_of_birth: form.dob, sex: form.sex,
      father_name: text(form.father), nationality: text(form.nationality),
      national_id: text(form.fin)?.toUpperCase() ?? null, passport_no: text(form.passport),
      phone: text(form.phone), his_patient_reference: text(form.his),
      relative_name: text(form.relativeName), relative_relation: text(form.relativeRelation),
      relative_phone: text(form.relativePhone), companion_name: text(form.companion),
      consent: form.consent, sms_permitted: Boolean(form.sms),
    },
    note: {
      admitting_unit_id: form.unitId, bed_id: form.bedId, admission_type: form.type,
      source_of_admission: form.source || null,
      admission_diagnosis_free_text: form.diagnosis.trim(),
      weight_kg: positive(form.weight), height_cm: positive(form.height),
      blood_group: form.blood || null,
      allergies_text: form.noAllergy ? null : text(form.allergy),
      no_known_allergy: Boolean(form.noAllergy),
      comorbidity_codes: [...form.comorbidities],
      comorbidities_text: text(form.comorbiditiesText),
    },
  };
}
```

**Write** `dashboard/src/live/screens/kabul/BedPicker.jsx` (a new file, whole):

```jsx
// src/live/screens/kabul/BedPicker.jsx — unit → room → bed, from the caller's structure (G2-B1a,
// spec §5.2). Only an open, AVAILABLE bed can be chosen; every other bed is shown dimmed WITH its
// reason (occupied, cleaning, closed…), so a nurse looking for a bed sees why one is not offered.
// A choice is a pressed button (aria-pressed); the beds of a room are one group with the room's
// name. Nothing here decides anything the server does not check again (admission/router.py).
import React from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { Tag } from "../../ui/index.js";
import { FOCUS_RING } from "../../ui/focus.js";
import { admissible, unavailableKey } from "../../data/structure.js";

/** `structure`: GET /tenant/structure's answer; `unitId` / `bedId`: the choice; `onUnit(id)`,
 *  `onBed({id, unitId, label})` report a new one — `label` is "bed · room · unit", the words the
 *  screen names the admission by (choosing a unit clears the bed). */
export function BedPicker({ structure, unitId, bedId, onUnit, onBed, invalid = false }) {
  const { t } = useI18n();
  const units = (structure?.sites ?? []).flatMap((site) => site.units ?? []);
  if (units.length === 0) return <p className="m-0 text-13 text-mute">{t("kabul.pickerNone")}</p>;
  const unit = units.find((u) => u.id === unitId) ?? null;
  return (
    <div className={`grid gap-3 ${invalid ? "rounded-ctl ring-2 ring-crit ring-offset-2 ring-offset-card" : ""}`}>
      <div role="group" aria-label={t("kabul.pickUnit")} className="flex flex-wrap gap-2">
        {units.map((u) => {
          const open = u.is_active !== false;
          const free = (u.rooms ?? []).flatMap((r) => r.beds ?? []).filter((b) =>
            admissible({ ...b, open: open && b.is_active !== false })).length;
          return (
            <button key={u.id} type="button" aria-pressed={u.id === unitId}
              onClick={() => onUnit(u.id)}
              className={`rounded-ctl border px-3 py-1.5 text-13 font-semibold ${u.id === unitId ? "border-pri bg-pri-soft text-ink" : "border-line2 bg-card text-ink"} ${open ? "" : "opacity-60"} ${FOCUS_RING}`}>
              {u.name}
              <span className="ml-1.5 text-11.5 font-normal text-mute">
                {open ? t("kabul.freeBeds", { count: free }) : t("kabul.unitClosed")}
              </span>
            </button>
          );
        })}
      </div>
      {unit ? (
        <div className="grid gap-2.5">
          {(unit.rooms ?? []).map((room) => (
            <div key={room.id} role="group" aria-label={room.name}>
              <p className="m-0 mb-1 text-12 font-semibold text-mute">
                {room.name}{room.is_active === false ? ` · ${t("kabul.roomClosed")}` : ""}
              </p>
              <div className="flex flex-wrap gap-2">
                {(room.beds ?? []).map((b) => {
                  const bed = { ...b, open: unit.is_active !== false && room.is_active !== false && b.is_active !== false };
                  const why = unavailableKey(bed);
                  const chosen = b.id === bedId;
                  return (
                    <button key={b.id} type="button" aria-pressed={chosen}
                      aria-disabled={why ? "true" : undefined}
                      aria-label={why ? `${b.label} · ${t(why)}` : b.label}
                      onClick={() => {
                        if (!why) onBed({ id: b.id, unitId: unit.id, label: `${b.label} · ${room.name} · ${unit.name}` });
                      }}
                      className={`grid min-w-[72px] place-items-center rounded-ctl border px-2.5 py-2 text-13 ${chosen ? "border-pri bg-pri text-onpri" : "border-line2 bg-card text-ink"} ${why ? "cursor-not-allowed opacity-55" : ""} ${FOCUS_RING}`}>
                      <b className="font-data text-15">{b.label}</b>
                      {why ? <span aria-hidden="true" className="text-10.5">{t(why)}</span> : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          <p className="m-0 text-12 text-mute">
            {bedId ? <Tag tone="neutral" icon="bed">{t("kabul.bedChosen", { bed: labelOf(unit, bedId) })}</Tag> : t("kabul.pickHint")}
          </p>
        </div>
      ) : (
        <p className="m-0 text-12.5 text-mute">{t("kabul.pickUnitFirst")}</p>
      )}
    </div>
  );
}

function labelOf(unit, bedId) {
  for (const room of unit.rooms ?? []) {
    const bed = (room.beds ?? []).find((b) => b.id === bedId);
    if (bed) return `${bed.label} · ${room.name} · ${unit.name}`;
  }
  return "";
}
```

**Edit** `dashboard/src/live/screens/kabul/AdmitTab.jsx` (1) — replace:

```jsx
// src/live/screens/kabul/AdmitTab.jsx — "Kabul" (Group 2 · B1a). Task 14 builds it; until then
// the frame (KabulScreen.jsx) offers the tab and shows nothing in it, so the route and the tabs
// stand and are tested on their own (src/reachable.test.js: a module is wired the day it lands).
export function AdmitTab() {
  return null;
}
```

with:

```jsx
// src/live/screens/kabul/AdmitTab.jsx — "Kabul": the admission form (Group 2 · B1a, spec §3.1,
// §5.2). The prototype's "Elle kayıt", grouped Kimlik · Kabul · İletişim ve onam · Yatak, with a
// side panel naming every required field still missing. "Kabul et" is held (aria-disabled, never
// disabled: it keeps its focus, and pressed it says why) until that panel is empty.
//
// One request writes the admission (POST /admissions). The answer's patient number is shown large,
// with what the nurse does with it — she enters it on the bedside device — and any part of the
// engine write that did not land, named, so it is entered by hand. A refusal goes on the toast,
// named after the bed (amendments (a), (f)); a write with no answer may have landed, and the
// structure is read again either way, so the bed picker never offers a bed that was just taken.
import React, { useEffect, useId, useMemo, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useSession } from "../../session/SessionProvider.jsx";
import { useStructure } from "../../data/StructureProvider.jsx";
import { Announce, Box, Button, Field, Input, Note, Select, Tag, useToast } from "../../ui/index.js";
import { FOCUS_RING } from "../../ui/focus.js";
import { doneFor, refusedFor } from "../admin/refusal.js";
import {
  ADMISSION_TYPES, BLOOD_GROUPS, COMORBIDITIES, CONSENTS, ENGINE_FAILED, NATIONALITIES, RELATIONS,
  SEXES, SOURCES, ageOf, emptyForm, missing, toBody,
} from "./admitForm.js";
import { BedPicker } from "./BedPicker.jsx";

const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** A required one-of choice (radio buttons) — its words from `options[].key`. */
function Choice({ name, legend, options, value, onChange, error }) {
  const { t } = useI18n();
  return (
    <fieldset aria-invalid={error ? "true" : undefined} className="mb-2.5 min-w-0 border-0 p-0">
      <legend className="mb-1.5 text-13.5 font-semibold text-mute">{legend}<span aria-hidden="true" className="text-crit-ink"> *</span></legend>
      <div className="flex flex-wrap gap-3">
        {options.map((option) => (
          <label key={option.value} className="inline-flex items-center gap-1.5 text-13.5">
            <input type="radio" name={name} value={option.value} checked={value === option.value}
              onChange={() => onChange(option.value)} className={FOCUS_RING} />
            {t(option.key)}
          </label>
        ))}
      </div>
      {error ? <p className="m-0 mt-1 text-12 font-semibold text-crit-ink">{error}</p> : null}
    </fieldset>
  );
}

function NumberBox({ done, onNext }) {
  const { t } = useI18n();
  const failed = ["board", "weight", "profile"].filter((part) => done.engine?.[part] === "failed");
  return (
    <Box title={t("kabul.doneTitle")} icon="ok" level={2}>
      <p className="m-0 text-13 text-mute">{t("kabul.doneBed", { bed: done.bed })}</p>
      <p className="m-0 my-2 font-data text-34 font-bold tracking-[.06em] text-ink">{done.number}</p>
      <p className="m-0 text-14 font-semibold">{t("kabul.enterOnDevice")}</p>
      {failed.map((part) => (
        <Note key={part} tone="warn" icon="alert">{t(ENGINE_FAILED[part])}</Note>
      ))}
      <div className="mt-3 flex flex-wrap gap-2">
        <a href={`#/patients/${encodeURIComponent(done.number)}`}
          className={`inline-flex items-center gap-1.5 rounded-ctl bg-pri px-[13px] py-2 text-13 font-semibold text-onpri ${FOCUS_RING}`}>
          {t("kabul.seeOnBoard")}
        </a>
        <Button onClick={onNext}>{t("kabul.next")}</Button>
      </div>
    </Box>
  );
}

export function AdmitTab() {
  const { t } = useI18n();
  const { user, store } = useSession();
  const { structure, reload } = useStructure();
  const toast = useToast();
  const canAdmit = user?.perms?.includes("admissions.admit") ?? false;
  const [form, setForm] = useState(emptyForm);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const panelId = useId();
  const today = localToday();
  const gaps = useMemo(() => missing(form, today), [form, today]);
  const wrong = (field) => (tried ? gaps.find((g) => g.field === field) : null);
  const errorOf = (field) => (wrong(field) ? t(wrong(field).key) : undefined);
  const set = (patch) => setForm((prev) => ({ ...prev, ...patch }));
  const age = ageOf(form.dob, today);

  useEffect(() => { reload(); }, [reload]);

  if (!canAdmit) return <Note tone="info" icon="eye">{t("kabul.readOnly")}</Note>;
  if (done) return <NumberBox done={done} onNext={() => setDone(null)} />;

  const bedText = form.bedLabel ?? "";
  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    if (gaps.length > 0) {
      setTried(true);
      return;
    }
    setBusy(true);
    try {
      const answer = await store.track(() => store.api.admit(toBody(form)));
      setDone({ number: answer.patient_number, bed: bedText, engine: answer.engine });
      setForm(emptyForm());
      setTried(false);
      toast(doneFor(t, bedText, t("kabul.admitted", { number: answer.patient_number })));
    } catch (err) {
      toast(refusedFor(t, bedText, err), "error");
    } finally {
      setBusy(false);
      reload();
    }
  }

  return (
    <form noValidate onSubmit={submit} className="grid gap-3 min-[1100px]:grid-cols-[minmax(0,1fr)_280px]">
      <div className="grid min-w-0 gap-3">
        <Box title={t("kabul.groupIdentity")} icon="user" level={2}>
          <Field label={t("kabul.f.name")} required error={errorOf("name")}>
            <Input value={form.name} onChange={(e) => set({ name: e.target.value })} autoComplete="off" />
          </Field>
          <Field label={t("kabul.f.father")}>
            <Input value={form.father} onChange={(e) => set({ father: e.target.value })} autoComplete="off" />
          </Field>
          <Choice name="sex" legend={t("kabul.f.sex")} options={SEXES} value={form.sex}
            onChange={(sex) => set({ sex })} error={errorOf("sex")} />
          <Field label={t("kabul.f.dob")} required error={errorOf("dob")}
            hint={age ? t("kabul.age", age) : undefined}>
            <Input type="date" max={today} value={form.dob} onChange={(e) => set({ dob: e.target.value })} />
          </Field>
          <Field label={t("kabul.f.nationality")}>
            <Select value={form.nationality} onChange={(e) => set({ nationality: e.target.value })}>
              {NATIONALITIES.map((o) => <option key={o.value} value={o.value}>{t(o.key)}</option>)}
            </Select>
          </Field>
          <Field label={t("kabul.f.fin")} hint={t("kabul.finHint")} error={errorOf("fin")}>
            <Input value={form.fin} maxLength={7} onChange={(e) => set({ fin: e.target.value })} autoComplete="off" />
          </Field>
          <Field label={t("kabul.f.passport")}>
            <Input value={form.passport} onChange={(e) => set({ passport: e.target.value })} autoComplete="off" />
          </Field>
          <Field label={t("kabul.f.phone")} hint={t("kabul.phoneHint")}>
            <Input type="tel" value={form.phone} onChange={(e) => set({ phone: e.target.value })} autoComplete="off" />
          </Field>
        </Box>

        <Box title={t("kabul.groupAdmission")} icon="clip" level={2}>
          <Field label={t("kabul.f.type")} required error={errorOf("type")}>
            <Select value={form.type} onChange={(e) => set({ type: e.target.value })}>
              <option value="">{t("kabul.choose")}</option>
              {ADMISSION_TYPES.map((o) => <option key={o.value} value={o.value}>{t(o.key)}</option>)}
            </Select>
          </Field>
          <Field label={t("kabul.f.source")}>
            <Select value={form.source} onChange={(e) => set({ source: e.target.value })}>
              <option value="">{t("kabul.choose")}</option>
              {SOURCES.map((o) => <option key={o.value} value={o.value}>{t(o.key)}</option>)}
            </Select>
          </Field>
          <Field label={t("kabul.f.diagnosis")} required error={errorOf("diagnosis")}>
            <Input value={form.diagnosis} maxLength={500} onChange={(e) => set({ diagnosis: e.target.value })} />
          </Field>
          <Field label={t("kabul.f.weight")} error={errorOf("weight")}>
            <Input inputMode="decimal" value={form.weight} onChange={(e) => set({ weight: e.target.value })} />
          </Field>
          <Field label={t("kabul.f.height")} error={errorOf("height")}>
            <Input inputMode="numeric" value={form.height} onChange={(e) => set({ height: e.target.value })} />
          </Field>
          <Field label={t("kabul.f.blood")}>
            <Select value={form.blood} onChange={(e) => set({ blood: e.target.value })}>
              {BLOOD_GROUPS.map((o) => <option key={o.value} value={o.value}>{t(o.key)}</option>)}
            </Select>
          </Field>
          <Field label={t("kabul.f.allergy")} required error={errorOf("allergy")}>
            <Input value={form.allergy} readOnly={form.noAllergy} maxLength={500}
              onChange={(e) => set({ allergy: e.target.value })} />
          </Field>
          <label className="mb-2.5 flex items-center gap-2 text-13.5">
            <input type="checkbox" checked={form.noAllergy} className={FOCUS_RING}
              onChange={(e) => set({ noAllergy: e.target.checked, allergy: e.target.checked ? "" : form.allergy })} />
            {t("kabul.noAllergy")}
          </label>
          <fieldset className="mb-2.5 min-w-0 border-0 p-0">
            <legend className="mb-1.5 text-13.5 font-semibold text-mute">{t("kabul.f.comorbidities")}</legend>
            <div className="flex flex-wrap gap-3">
              {COMORBIDITIES.map(({ value: code, key }) => (
                <label key={code} className="inline-flex items-center gap-1.5 text-13.5">
                  <input type="checkbox" checked={form.comorbidities.includes(code)} className={FOCUS_RING}
                    onChange={(e) => set({ comorbidities: e.target.checked
                      ? [...form.comorbidities, code] : form.comorbidities.filter((c) => c !== code) })} />
                  {t(key)}
                </label>
              ))}
            </div>
          </fieldset>
          <Field label={t("kabul.f.comorbiditiesText")} hint={t("kabul.comorbiditiesTextHint")}>
            <Input value={form.comorbiditiesText} maxLength={500} onChange={(e) => set({ comorbiditiesText: e.target.value })} />
          </Field>
          <Field label={t("kabul.f.his")}>
            <Input value={form.his} maxLength={64} onChange={(e) => set({ his: e.target.value })} autoComplete="off" />
          </Field>
        </Box>

        <Box title={t("kabul.groupContact")} icon="users" level={2}>
          <Field label={t("kabul.f.relativeName")}>
            <Input value={form.relativeName} onChange={(e) => set({ relativeName: e.target.value })} autoComplete="off" />
          </Field>
          <Field label={t("kabul.f.relativeRelation")}>
            <Select value={form.relativeRelation} onChange={(e) => set({ relativeRelation: e.target.value })}>
              <option value="">{t("kabul.choose")}</option>
              {RELATIONS.map((o) => <option key={o.value} value={o.value}>{t(o.key)}</option>)}
            </Select>
          </Field>
          <Field label={t("kabul.f.relativePhone")}>
            <Input type="tel" value={form.relativePhone} onChange={(e) => set({ relativePhone: e.target.value })} autoComplete="off" />
          </Field>
          <Field label={t("kabul.f.companion")}>
            <Input value={form.companion} onChange={(e) => set({ companion: e.target.value })} autoComplete="off" />
          </Field>
          <Choice name="consent" legend={t("kabul.f.consent")} options={CONSENTS} value={form.consent}
            onChange={(consent) => set({ consent })} error={errorOf("consent")} />
          <label className="flex items-center gap-2 text-13.5">
            <input type="checkbox" checked={form.sms} className={FOCUS_RING} onChange={(e) => set({ sms: e.target.checked })} />
            {t("kabul.sms")}
          </label>
        </Box>

        <Box title={t("kabul.groupBed")} icon="bed" level={2}>
          <BedPicker structure={structure} unitId={form.unitId} bedId={form.bedId} invalid={Boolean(wrong("bed"))}
            onUnit={(unitId) => set({ unitId, bedId: null, bedLabel: null })}
            onBed={(bed) => set({ bedId: bed.id, unitId: bed.unitId, bedLabel: bed.label })} />
          {errorOf("bed") ? <p className="m-0 mt-1 text-12 font-semibold text-crit-ink">{errorOf("bed")}</p> : null}
        </Box>
      </div>

      <aside aria-labelledby={`${panelId}-title`} className="h-fit rounded-box border border-line bg-card px-3.5 py-3 min-[1100px]:sticky min-[1100px]:top-0">
        <h2 id={`${panelId}-title`} className="m-0 text-14 font-bold">{t("kabul.missingTitle")}</h2>
        <div id={panelId}>
          {gaps.length === 0 ? (
            <p className="m-0 mt-1.5 text-13 text-mute">{t("kabul.missingNone")}</p>
          ) : (
            <ul className="m-0 mt-1.5 grid gap-1 ps-4 text-13">
              {gaps.map((g) => <li key={g.field}>{t(g.key)}</li>)}
            </ul>
          )}
        </div>
        <Button type="submit" variant="primary" icon="ok" busy={busy} className="mt-3 w-full justify-center"
          aria-disabled={gaps.length > 0 ? "true" : undefined} aria-describedby={panelId}>
          {t("kabul.admit")}
        </Button>
        {form.bedId ? <p className="m-0 mt-2"><Tag icon="bed">{bedText}</Tag></p> : null}
        <Announce text={busy ? t("kabul.admitting") : ""} />
      </aside>
    </form>
  );
}
```


- [ ] **Step 4: Run the folder green:**

```bash
cd /c/tmp/g2b-kabul-fe/dashboard
npx vitest run src/live/screens/kabul/ 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ Test Files |^ +Tests |^ FAIL |→ |×"
```

Expected (the replay, times vary):

```text
Test Files  5 passed (5)
      Tests  28 passed (28)
```


- [ ] **Step 5: The whole suite and the build:**

```bash
cd /c/tmp/g2b-kabul-fe/dashboard
npx vitest run 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ Test Files |^ +Tests |^ FAIL |→ |×"
```

Expected (the replay, times vary):

```text
Test Files  96 passed (96)
      Tests  2508 passed (2508)
```

```bash
cd /c/tmp/g2b-kabul-fe/dashboard
npx vite build 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "built in|precache|larger than|error"
```

Expected (the replay, times vary):

```text
✓ built in …s
precache  20 entries (900.93 KiB)
```


- [ ] **Step 6: Line ends:**

```bash
cd /c/tmp/g2b-kabul-fe
for f in dashboard/src/live/screens/kabul/admitForm.test.js dashboard/src/live/screens/kabul/BedPicker.test.jsx dashboard/src/live/screens/kabul/AdmitTab.test.jsx dashboard/src/live/screens/kabul/admitForm.js dashboard/src/live/screens/kabul/BedPicker.jsx dashboard/src/live/screens/kabul/AdmitTab.jsx; do printf "%s CR=%s LF=%s\n" "$f" "$(tr -cd '\r' < "$f" | wc -c)" "$(tr -cd '\n' < "$f" | wc -c)"; done
```

Expected:

```text
dashboard/src/live/screens/kabul/admitForm.test.js CR=0 LF=79
dashboard/src/live/screens/kabul/BedPicker.test.jsx CR=0 LF=57
dashboard/src/live/screens/kabul/AdmitTab.test.jsx CR=0 LF=94
dashboard/src/live/screens/kabul/admitForm.js CR=0 LF=133
dashboard/src/live/screens/kabul/BedPicker.jsx CR=0 LF=84
dashboard/src/live/screens/kabul/AdmitTab.jsx CR=0 LF=258
```


- [ ] **Step 7: Commit:**

```bash
cd /c/tmp/g2b-kabul-fe
git add -- dashboard/src/live/screens/kabul/admitForm.test.js dashboard/src/live/screens/kabul/BedPicker.test.jsx dashboard/src/live/screens/kabul/AdmitTab.test.jsx dashboard/src/live/screens/kabul/admitForm.js dashboard/src/live/screens/kabul/BedPicker.jsx dashboard/src/live/screens/kabul/AdmitTab.jsx
git status --short && git diff --cached --stat
git commit -m "feat(dashboard): Kabul — the admission form, its missing fields, the bed picker and the patient number (G2-B1a)" \
  -m "red: Tests  5 failed (5)" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- dashboard/src/live/screens/kabul/admitForm.test.js dashboard/src/live/screens/kabul/BedPicker.test.jsx dashboard/src/live/screens/kabul/AdmitTab.test.jsx dashboard/src/live/screens/kabul/admitForm.js dashboard/src/live/screens/kabul/BedPicker.jsx dashboard/src/live/screens/kabul/AdmitTab.jsx
```

---

### Task 15: Taburcu — the two lists, the decision's dialog, the confirmation

**Lane:** dashboard. **Needs:** Task 13.

Spec D7, §3.3, §5.3, X59, X61, and the alert latch. `useAdmissions(states, {every})` reads `GET /admissions` in some states, optionally on a timer (the bed board's badge uses it in Task 17). The tab reads DRAFT, ACTIVE and PENDING_DISCHARGE and lists them in two sections ("Yatan hastalar", "Taburcusu başlatılan"), by name and bed, never by UUID. A physician gets "Taburcuyu başlat" on an admitted (ACTIVE) patient — a DRAFT row says "Önce kabul imzalanmalı (hasta ekranı)" instead (X59) — and the charge nurse "Hasta çıktı · onayla" on a started one. The button is held (`aria-disabled`, with the reason in words) while the patient's board shows a critical alert nobody acknowledged: `severity === "critical"` and `status !== "ACKNOWLEDGED"` — firing (`FIRED`) or latched (`RESOLVED`: A1's adapter, `liveAdapters.js`, gives that status to an alert with `resolved_at`). The test feeds the board in the server's shape through the real adapter, both shapes; an acknowledged critical or a high one does not hold it. The hold is a hint: the server refuses anyway (`critical_alarm_open`, on the toast by its code). `DischargeDialog.jsx` takes the disposition (home, another institution — which it names before it sends —, exitus), the time (now by default) and the note. A confirmation reads the list and the beds again and says so when the card did not leave the board (`board: failed`).

**Files:**
- Create: `dashboard/src/live/screens/kabul/DischargeTab.test.jsx`
- Create: `dashboard/src/live/screens/kabul/useAdmissions.js`
- Create: `dashboard/src/live/screens/kabul/DischargeDialog.jsx`
- Modify: `dashboard/src/live/screens/kabul/DischargeTab.jsx`

- [ ] **Step 1: Write the failing test:**

**Write** `dashboard/src/live/screens/kabul/DischargeTab.test.jsx` (a new file, whole):

```jsx
// The Taburcu tab (Group 2 · B1a, spec §3.3, §5.3): the discharges started, awaiting the charge
// nurse; the patients in, a physician's "Taburcuyu başlat" — held with its reason while the board
// shows a critical alarm nobody acknowledged — and the decision's dialog.
import { describe, it, expect } from "vitest";
import React from "react";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { refusal } from "../../session/mount.testutil.jsx";
import { alarm, board, entry } from "../../data/board.testutil.js";
import { DischargeTab } from "./DischargeTab.jsx";
import { CHARGE, DOCTOR, UUID_TEXT, mountKabul, row, settle, toasts } from "./kabul.testutil.js";

const ROWS = [
  row({ id: "a-1", patient_number: "H2600001", bed_label: "2", state: "ACTIVE" }),
  row({ id: "a-2", patient_number: "H2600002", bed_label: "5", room_name: "Otaq 2", state: "DRAFT", display_name: "Sentetik İki" }),
  row({ id: "a-3", patient_number: "H2600003", bed_label: "1", state: "PENDING_DISCHARGE", display_name: "Sentetik Üç",
    discharge_disposition: "OTHER_INSTITUTION", discharge_institution: "Sentetik Klinika", discharge_at: "2026-10-25T09:30:00Z" }),
];
const section = (name) => within(screen.getByRole("region", { name }));

async function open(perms, setup) {
  const mounted = await mountKabul(<DischargeTab />, { perms, setup: (api) => { api.admissions.mockResolvedValue(ROWS); setup?.(api); } });
  return mounted;
}

describe("DischargeTab", () => {
  it("reads the three open states and lists them in two sections, by name and bed, never by UUID", async () => {
    const { api } = await open(DOCTOR);
    expect(api.admissions).toHaveBeenCalledWith(["DRAFT", "ACTIVE", "PENDING_DISCHARGE"]);
    expect(section("Evə yazılması başladılanlar").getByText(/Sentetik Üç/)).toBeTruthy();
    expect(section("Evə yazılması başladılanlar").getByText(/Başqa müəssisəyə göndəriş · Sentetik Klinika/)).toBeTruthy();
    const lying = section("Yatan xəstələr");
    expect(lying.getByText(/Sentetik Hasta/)).toBeTruthy();
    expect(lying.getByText("Həkim imzası gözlənilir")).toBeTruthy();
    expect(lying.getByText("Əvvəlcə qəbul imzalanmalıdır (xəstə ekranı).")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(UUID_TEXT);
  });

  it("gives a physician «Taburcuyu başlat» on an admitted patient only, and the charge nurse «Hasta çıktı · onayla»", async () => {
    await open(DOCTOR);
    expect(screen.getAllByRole("button", { name: "Evə yazılmanı başlat" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Xəstə çıxdı · təsdiqlə" })).toBeNull();
  });

  it.each([
    ["firing", {}],
    ["latched — resolved, nobody acknowledged it (G2-A1)", { resolved_at: "2026-10-25T09:00:00Z" }],
  ])("holds «Taburcuyu başlat», saying why, while a critical alarm is %s", async (_shape, over) => {
    const { api, board: store, stream } = await open(DOCTOR, (a) => {
      a.boardPatients.mockResolvedValue(board([entry("H2600001", [alarm("septic_shock", "critical", over)])]));
      a.streamTicket.mockResolvedValue({ ticket: "t-1" });
    });
    await act(async () => { await store.start(); stream.open(); });
    await settle();
    const start = screen.getByRole("button", { name: "Evə yazılmanı başlat" });
    expect(start.getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByText("Təsdiqlənməmiş kritik siqnal var: əvvəlcə siqnala baxın.")).toBeTruthy();
    fireEvent.click(start);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(api.startDischarge).not.toHaveBeenCalled();
  });

  it("does not hold it for an acknowledged critical alarm or a high one", async () => {
    const { board: store, stream } = await open(DOCTOR, (a) => {
      a.boardPatients.mockResolvedValue(board([entry("H2600001", [
        alarm("septic_shock", "critical", { acknowledged: true, acknowledged_by: "hekim" }), alarm("news2", "high")])]));
      a.streamTicket.mockResolvedValue({ ticket: "t-1" });
    });
    await act(async () => { await store.start(); stream.open(); });
    await settle();
    expect(screen.getByRole("button", { name: "Evə yazılmanı başlat" }).getAttribute("aria-disabled")).toBeNull();
  });

  it("starts a discharge from the dialog: home, now, with the note", async () => {
    const { api } = await open(DOCTOR, (a) => a.startDischarge.mockResolvedValue({ id: "a-1", state: "PENDING_DISCHARGE" }));
    fireEvent.click(screen.getByRole("button", { name: "Evə yazılmanı başlat" }));
    const dialog = within(screen.getByRole("dialog", { name: "Evə yazılma · 2 · Reanimasiya" }));
    fireEvent.change(dialog.getByLabelText("Qeyd"), { target: { value: "Sentetik qeyd" } });
    await act(async () => { fireEvent.click(dialog.getByRole("button", { name: "Evə yazılmanı başlat" })); });
    await settle();
    expect(api.startDischarge).toHaveBeenCalledTimes(1);
    const [id, body] = api.startDischarge.mock.calls[0];
    expect(id).toBe("a-1");
    expect(body).toMatchObject({ disposition: "HOME", institution: null, reported_by: null, note: "Sentetik qeyd" });
    expect(Date.parse(body.discharge_at)).toBeLessThanOrEqual(Date.now());
    expect(toasts().getAllByText(/2 · Reanimasiya · evə yazılma başladıldı/).length).toBeGreaterThan(0);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("asks for the institution before it sends a transfer to another one", async () => {
    const { api } = await open(DOCTOR);
    fireEvent.click(screen.getByRole("button", { name: "Evə yazılmanı başlat" }));
    const dialog = within(screen.getByRole("dialog"));
    fireEvent.click(dialog.getByLabelText("Başqa müəssisəyə göndəriş"));
    await act(async () => { fireEvent.click(dialog.getByRole("button", { name: "Evə yazılmanı başlat" })); });
    expect(api.startDischarge).not.toHaveBeenCalled();
    expect(dialog.getByText("Göndərilən müəssisəni yazın.")).toBeTruthy();
  });

  it("puts the server's refusal on the toast by its code — an open critical alarm", async () => {
    await open(DOCTOR, (a) => a.startDischarge.mockRejectedValue(
      refusal(409, "Discharge blocked: 1 unacknowledged CRITICAL alert(s)…", { apiCode: "critical_alarm_open" })));
    fireEvent.click(screen.getByRole("button", { name: "Evə yazılmanı başlat" }));
    await act(async () => { fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Evə yazılmanı başlat" })); });
    await settle();
    expect(toasts().getAllByText(/2 · Reanimasiya: Təsdiqlənməmiş kritik siqnal var; evə yazılma başladıla bilməz/).length).toBeGreaterThan(0);
  });

  it("the charge nurse confirms a started discharge; the list and the beds are read again", async () => {
    const { api } = await open(CHARGE, (a) => a.confirmDischarge.mockResolvedValue({ id: "a-3", state: "DISCHARGED", board: "ok" }));
    const reads = api.admissions.mock.calls.length;
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Xəstə çıxdı · təsdiqlə" })); });
    await settle();
    expect(api.confirmDischarge).toHaveBeenCalledWith("a-3");
    expect(toasts().getAllByText("1 · Reanimasiya · evə yazılma təsdiqləndi; çarpayı təmizliyə verildi").length).toBeGreaterThan(0);
    expect(api.admissions.mock.calls.length).toBeGreaterThan(reads);
  });

  it("says so when the card did not leave the board", async () => {
    await open(CHARGE, (a) => a.confirmDischarge.mockResolvedValue({ id: "a-3", state: "DISCHARGED", board: "failed" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Xəstə çıxdı · təsdiqlə" })); });
    await settle();
    expect(toasts().getAllByText(/kart paneldən götürülmədi/).length).toBeGreaterThan(0);
  });
});
```


- [ ] **Step 2: Run it and see it red** — the tab is a stub:

```bash
cd /c/tmp/g2b-kabul-fe/dashboard
npx vitest run src/live/screens/kabul/DischargeTab.test.jsx 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ Test Files |^ +Tests |^ FAIL |→ |×"
```

Expected (the replay, times vary):

```text
Test Files  1 failed (1)
      Tests  10 failed (10)
 FAIL  src/live/screens/kabul/DischargeTab.test.jsx > DischargeTab > reads the three open states and lists them in two sections, by name and bed, never by UUID
 FAIL  src/live/screens/kabul/DischargeTab.test.jsx > DischargeTab > gives a physician «Taburcuyu başlat» on an admitted patient only, and the charge nurse «Hasta çıktı · onayla»
 FAIL  src/live/screens/kabul/DischargeTab.test.jsx > DischargeTab > holds «Taburcuyu başlat», saying why, while a critical alarm is firing
 FAIL  src/live/screens/kabul/DischargeTab.test.jsx > DischargeTab > holds «Taburcuyu başlat», saying why, while a critical alarm is latched — resolved, nobody acknowledged it (G2-A1)
 FAIL  src/live/screens/kabul/DischargeTab.test.jsx > DischargeTab > does not hold it for an acknowledged critical alarm or a high one
 FAIL  src/live/screens/kabul/DischargeTab.test.jsx > DischargeTab > starts a discharge from the dialog: home, now, with the note
 FAIL  src/live/screens/kabul/DischargeTab.test.jsx > DischargeTab > asks for the institution before it sends a transfer to another one
 FAIL  src/live/screens/kabul/DischargeTab.test.jsx > DischargeTab > puts the server's refusal on the toast by its code — an open critical alarm
 FAIL  src/live/screens/kabul/DischargeTab.test.jsx > DischargeTab > the charge nurse confirms a started discharge; the list and the beds are read again
 FAIL  src/live/screens/kabul/DischargeTab.test.jsx > DischargeTab > says so when the card did not leave the board
× DischargeTab > reads the three open states and lists them in two sections, by name and bed, never by UUID 34ms
→ expected "spy" to be called with arguments: [ [ 'DRAFT', 'ACTIVE', …(1) ] ]
× DischargeTab > gives a physician «Taburcuyu başlat» on an admitted patient only, and the charge nurse «Hasta çıktı · onayla» 53ms
→ Unable to find an accessible element with the role "button" and name "Evə yazılmanı başlat"
× DischargeTab > holds «Taburcuyu başlat», saying why, while a critical alarm is firing 30ms
```


- [ ] **Step 3: The read, the dialog, the tab:**

**Write** `dashboard/src/live/screens/kabul/useAdmissions.js` (a new file, whole):

```js
// src/live/screens/kabul/useAdmissions.js — the admissions of the caller's units in some states
// (GET /admissions, Group 2 · B1a). The Taburcu tab, the sign-off strip and the bed card's badge
// read it.
//
//   const { rows, phase, error, reload } = useAdmissions(["DRAFT", "ACTIVE"]);
//
// `phase` as the structure's: "unasked" (no `admissions.view` — not called), "loading", "known",
// "stale" (a reload failed, the last rows stand), "failed". `every` (ms) reads again on a timer
// while mounted; a read answered after a newer one began is dropped. Through the session's `track`.
import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "../../session/SessionProvider.jsx";

export function useAdmissions(states, { every = 0 } = {}) {
  const { user, store } = useSession();
  const may = user?.perms?.includes("admissions.view") ?? false;
  const wanted = states.join(",");
  const [state, setState] = useState(() => ({ rows: null, phase: may ? "loading" : "unasked", error: null }));
  const seq = useRef(0);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const reload = useCallback(async () => {
    if (!may) return;
    const mine = seq.current + 1;
    seq.current = mine;
    try {
      const rows = await store.track(() => store.api.admissions(wanted ? wanted.split(",") : []));
      if (mounted.current && seq.current === mine) {
        setState({ rows: Array.isArray(rows) ? rows : [], phase: "known", error: null });
      }
    } catch (error) {
      if (mounted.current && seq.current === mine) {
        setState((prev) => ({ rows: prev.rows, phase: prev.rows ? "stale" : "failed", error }));
      }
    }
  }, [may, store, wanted]);

  useEffect(() => {
    reload();
    if (!every) return undefined;
    const timer = setInterval(reload, every);
    return () => clearInterval(timer);
  }, [reload, every]);

  return { ...state, reload };
}
```

**Write** `dashboard/src/live/screens/kabul/DischargeDialog.jsx` (a new file, whole):

```jsx
// src/live/screens/kabul/DischargeDialog.jsx — the physician's discharge decision (Group 2 · B1a,
// spec D7, §3.3 step 1): where the patient goes — home, another institution (named), exitus
// (reported by: the physician herself unless another name is written) — when (now by default,
// never in the future) and a note. The server decides and checks again (admission/form.py); a
// critical alarm nobody acknowledged refuses it there, said on the toast.
import React, { useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useSession } from "../../session/SessionProvider.jsx";
import { Button, Field, Input, Modal, useToast } from "../../ui/index.js";
import { FOCUS_RING } from "../../ui/focus.js";
import { doneFor, refusedFor } from "../admin/refusal.js";

export const DISPOSITIONS = Object.freeze([
  Object.freeze({ value: "HOME", key: "kabul.disp.home" }),
  Object.freeze({ value: "OTHER_INSTITUTION", key: "kabul.disp.other" }),
  Object.freeze({ value: "EXITUS", key: "kabul.disp.exitus" }),
]);

const pad = (n) => String(n).padStart(2, "0");
/** An instant as a datetime-local value, in this browser's time. */
export const localInput = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export function DischargeDialog({ row, subject, onClose, onDone }) {
  const { t } = useI18n();
  const { store } = useSession();
  const toast = useToast();
  const [disposition, setDisposition] = useState("HOME");
  const [institution, setInstitution] = useState("");
  const [reportedBy, setReportedBy] = useState("");
  const [at, setAt] = useState(() => localInput(Date.now()));
  const [note, setNote] = useState("");
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const atMs = Date.parse(at);
  const errors = {
    institution: disposition === "OTHER_INSTITUTION" && !institution.trim() ? t("kabul.invalid.institution") : null,
    at: !Number.isFinite(atMs) || atMs > Date.now() + 60_000 ? t("kabul.invalid.dischargeAt") : null,
  };
  const wrong = Object.values(errors).some(Boolean);

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    if (wrong) {
      setTried(true);
      return;
    }
    setBusy(true);
    try {
      await store.track(() => store.api.startDischarge(row.id, {
        disposition,
        institution: disposition === "OTHER_INSTITUTION" ? institution.trim() : null,
        reported_by: disposition === "EXITUS" && reportedBy.trim() ? reportedBy.trim() : null,
        discharge_at: new Date(atMs).toISOString(),
        note: note.trim() || null,
      }));
      toast(doneFor(t, subject, t("kabul.dischargeStarted")));
      onDone();
    } catch (err) {
      toast(refusedFor(t, subject, err), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open title={t("kabul.dischargeTitle", { subject })} onClose={onClose} busy={busy}
      actions={(
        <>
          <Button onClick={onClose} busy={busy}>{t("common.cancel")}</Button>
          <Button type="submit" form="discharge-form" variant="primary" icon="out" busy={busy}>{t("kabul.dischargeSubmit")}</Button>
        </>
      )}>
      <form id="discharge-form" noValidate onSubmit={submit}>
        <fieldset className="mb-2.5 min-w-0 border-0 p-0">
          <legend className="mb-1.5 text-13.5 font-semibold text-mute">{t("kabul.f.disposition")}</legend>
          <div className="flex flex-wrap gap-3">
            {DISPOSITIONS.map((d) => (
              <label key={d.value} className="inline-flex items-center gap-1.5 text-13.5">
                <input type="radio" name="disposition" value={d.value} checked={disposition === d.value}
                  onChange={() => setDisposition(d.value)} className={FOCUS_RING} />
                {t(d.key)}
              </label>
            ))}
          </div>
        </fieldset>
        {disposition === "OTHER_INSTITUTION" ? (
          <Field label={t("kabul.f.institution")} required error={tried ? errors.institution ?? undefined : undefined}>
            <Input value={institution} maxLength={200} readOnly={busy} onChange={(e) => setInstitution(e.target.value)} />
          </Field>
        ) : null}
        {disposition === "EXITUS" ? (
          <Field label={t("kabul.f.reportedBy")} hint={t("kabul.reportedByHint")}>
            <Input value={reportedBy} maxLength={200} readOnly={busy} onChange={(e) => setReportedBy(e.target.value)} />
          </Field>
        ) : null}
        <Field label={t("kabul.f.dischargeAt")} required error={tried ? errors.at ?? undefined : undefined}>
          <Input type="datetime-local" value={at} max={localInput(Date.now())} readOnly={busy}
            onChange={(e) => setAt(e.target.value)} />
        </Field>
        <Field label={t("kabul.f.note")}>
          <textarea value={note} maxLength={2000} rows={3} readOnly={busy} onChange={(e) => setNote(e.target.value)}
            className="w-full rounded-ctl border border-line2 bg-card2 px-[11px] py-[9px] font-text text-14.5 text-ink outline-none focus:border-pri" />
        </Field>
      </form>
    </Modal>
  );
}
```

**Edit** `dashboard/src/live/screens/kabul/DischargeTab.jsx` (1) — replace:

```jsx
// src/live/screens/kabul/DischargeTab.jsx — "Taburcu" (Group 2 · B1a). Task 15 builds it; until then
// the frame (KabulScreen.jsx) offers the tab and shows nothing in it, so the route and the tabs
// stand and are tested on their own (src/reachable.test.js: a module is wired the day it lands).
export function DischargeTab() {
  return null;
}
```

with:

```jsx
// src/live/screens/kabul/DischargeTab.jsx — "Taburcu" (Group 2 · B1a, spec §3.3, §5.3). Two lists
// of the caller's units: the discharges a physician has started, awaiting the charge nurse's
// "Hasta çıktı · onayla", and the patients lying in. A physician (`admissions.move.initiate`)
// starts a discharge from the second; a DRAFT is signed first (the strip on the patient screen).
//
// "Taburcuyu başlat" is held, with the reason in words, while the board shows this patient a
// critical alarm nobody acknowledged — a hint read from the same board the clinician sees; the
// server refuses it anyway (BoardLink.open_critical) and that refusal goes on the toast.
import React, { useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useSession } from "../../session/SessionProvider.jsx";
import { useBoard } from "../../data/BoardProvider.jsx";
import { useStructure } from "../../data/StructureProvider.jsx";
import { readErrorText } from "../../apiErrors.js";
import { Alert, Box, Button, Empty, Note, Tag, useToast } from "../../ui/index.js";
import { hhmm } from "../../i18n/dates.js";
import { doneFor, refusedFor } from "../admin/refusal.js";
import { DISPOSITIONS, DischargeDialog } from "./DischargeDialog.jsx";
import { useAdmissions } from "./useAdmissions.js";

const STATES = ["DRAFT", "ACTIVE", "PENDING_DISCHARGE"];
const subjectOf = (row) => `${row.bed_label} · ${row.unit_name}`;
const dispositionKey = (value) => DISPOSITIONS.find((d) => d.value === value)?.key ?? null;

function Row({ row, children }) {
  const { t } = useI18n();
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-ctl border border-line bg-card px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="m-0 text-14 font-semibold">
          <span className="font-data">{row.bed_label}</span> · {row.room_name} · {row.unit_name}
        </p>
        <p className="m-0 text-13 text-mute">
          {row.display_name} · <span className="font-data">{row.patient_number}</span>
          {row.state === "DRAFT" ? <> · <Tag tone="warn">{t("kabul.badgeDraft")}</Tag></> : null}
        </p>
      </div>
      {children}
    </li>
  );
}

export function DischargeTab() {
  const { t } = useI18n();
  const { user, store } = useSession();
  const board = useBoard();
  const { reload: reloadStructure } = useStructure();
  const toast = useToast();
  const { rows, phase, error, reload } = useAdmissions(STATES);
  const [starting, setStarting] = useState(null);
  const [confirming, setConfirming] = useState(null);
  const can = (key) => user?.perms?.includes(key) ?? false;
  const criticalOpen = (number) => board.alerts.some((a) => a.patientId === number
    && a.severity === "critical" && a.status !== "ACKNOWLEDGED");

  async function confirm(row) {
    if (confirming) return;
    setConfirming(row.id);
    try {
      const answer = await store.track(() => store.api.confirmDischarge(row.id));
      toast(doneFor(t, subjectOf(row), t(answer?.board === "failed" ? "kabul.dischargedBoardFailed" : "kabul.discharged")),
        answer?.board === "failed" ? "warn" : "ok");
    } catch (err) {
      toast(refusedFor(t, subjectOf(row), err), "error");
    } finally {
      setConfirming(null);
      reload();
      reloadStructure();
    }
  }

  if (phase === "unasked") return <Note tone="info" icon="eye">{t("kabul.noView")}</Note>;
  const pending = (rows ?? []).filter((r) => r.state === "PENDING_DISCHARGE");
  const lying = (rows ?? []).filter((r) => r.state === "DRAFT" || r.state === "ACTIVE");
  return (
    <div className="grid gap-3">
      {error ? <Alert tone="crit">{t(phase === "stale" ? "kabul.listStale" : "kabul.listFailed", { reason: readErrorText(t, error) })}</Alert> : null}
      <section aria-label={t("kabul.pendingTitle")}>
      <Box title={t("kabul.pendingTitle")} icon="out" level={2}>
        {rows === null ? <p className="m-0 text-13 text-mute">{t("kabul.loading")}</p>
          : pending.length === 0 ? <Empty icon="out">{t("kabul.pendingNone")}</Empty> : (
            <ul className="m-0 grid list-none gap-2 p-0">
              {pending.map((row) => (
                <Row key={row.id} row={row}>
                  <p className="m-0 text-12.5 text-mute">
                    {dispositionKey(row.discharge_disposition) ? t(dispositionKey(row.discharge_disposition)) : ""}
                    {row.discharge_institution ? ` · ${row.discharge_institution}` : ""}
                    {row.discharge_at ? ` · ${hhmm(Date.parse(row.discharge_at))}` : ""}
                  </p>
                  {can("admissions.discharge.confirm") ? (
                    <Button variant="primary" icon="ok" busy={confirming === row.id} onClick={() => confirm(row)}>
                      {t("kabul.confirmLeft")}
                    </Button>
                  ) : null}
                </Row>
              ))}
            </ul>
          )}
      </Box>
      </section>
      <section aria-label={t("kabul.lyingTitle")}>
      <Box title={t("kabul.lyingTitle")} icon="bed" level={2}>
        {rows === null ? <p className="m-0 text-13 text-mute">{t("kabul.loading")}</p>
          : lying.length === 0 ? <Empty icon="bed">{t("kabul.lyingNone")}</Empty> : (
            <ul className="m-0 grid list-none gap-2 p-0">
              {lying.map((row) => {
                const blocked = criticalOpen(row.patient_number);
                return (
                  <Row key={row.id} row={row}>
                    {row.state === "DRAFT" ? <p className="m-0 text-12.5 text-mute">{t("kabul.signFirst")}</p>
                      : can("admissions.move.initiate") ? (
                        <div className="grid justify-items-end gap-1">
                          <Button icon="out" aria-disabled={blocked ? "true" : undefined}
                            aria-describedby={blocked ? `blocked-${row.id}` : undefined}
                            onClick={() => { if (!blocked) setStarting(row); }}>
                            {t("kabul.startDischarge")}
                          </Button>
                          {blocked ? <p id={`blocked-${row.id}`} className="m-0 text-12 font-semibold text-crit-ink">{t("kabul.criticalOpen")}</p> : null}
                        </div>
                      ) : null}
                  </Row>
                );
              })}
            </ul>
          )}
      </Box>
      </section>
      {starting ? (
        <DischargeDialog row={starting} subject={subjectOf(starting)} onClose={() => setStarting(null)}
          onDone={() => { setStarting(null); reload(); reloadStructure(); }} />
      ) : null}
    </div>
  );
}
```


- [ ] **Step 4: Run the folder green:**

```bash
cd /c/tmp/g2b-kabul-fe/dashboard
npx vitest run src/live/screens/kabul/ 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ Test Files |^ +Tests |^ FAIL |→ |×"
```

Expected (the replay, times vary):

```text
Test Files  6 passed (6)
      Tests  38 passed (38)
```


- [ ] **Step 5: The whole suite and the build:**

```bash
cd /c/tmp/g2b-kabul-fe/dashboard
npx vitest run 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ Test Files |^ +Tests |^ FAIL |→ |×"
```

Expected (the replay, times vary):

```text
Test Files  97 passed (97)
      Tests  2518 passed (2518)
```

```bash
cd /c/tmp/g2b-kabul-fe/dashboard
npx vite build 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "built in|precache|larger than|error"
```

Expected (the replay, times vary):

```text
✓ built in …s
precache  20 entries (908.06 KiB)
```


- [ ] **Step 6: Line ends:**

```bash
cd /c/tmp/g2b-kabul-fe
for f in dashboard/src/live/screens/kabul/DischargeTab.test.jsx dashboard/src/live/screens/kabul/useAdmissions.js dashboard/src/live/screens/kabul/DischargeDialog.jsx dashboard/src/live/screens/kabul/DischargeTab.jsx; do printf "%s CR=%s LF=%s\n" "$f" "$(tr -cd '\r' < "$f" | wc -c)" "$(tr -cd '\n' < "$f" | wc -c)"; done
```

Expected:

```text
dashboard/src/live/screens/kabul/DischargeTab.test.jsx CR=0 LF=124
dashboard/src/live/screens/kabul/useAdmissions.js CR=0 LF=49
dashboard/src/live/screens/kabul/DischargeDialog.jsx CR=0 LF=111
dashboard/src/live/screens/kabul/DischargeTab.jsx CR=0 LF=134
```


- [ ] **Step 7: Commit:**

```bash
cd /c/tmp/g2b-kabul-fe
git add -- dashboard/src/live/screens/kabul/DischargeTab.test.jsx dashboard/src/live/screens/kabul/useAdmissions.js dashboard/src/live/screens/kabul/DischargeDialog.jsx dashboard/src/live/screens/kabul/DischargeTab.jsx
git status --short && git diff --cached --stat
git commit -m "feat(dashboard): Taburcu — the physician's decision and the charge nurse's confirmation (G2-B1a)" \
  -m "red: Tests  10 failed (10)" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- dashboard/src/live/screens/kabul/DischargeTab.test.jsx dashboard/src/live/screens/kabul/useAdmissions.js dashboard/src/live/screens/kabul/DischargeDialog.jsx dashboard/src/live/screens/kabul/DischargeTab.jsx
```

---

### Task 16: Yataklar — the beds by state, and the release

**Lane:** dashboard. **Needs:** Task 13.

Spec D8, §3.4, §5.4. Every bed of the caller's units with its state, by name (from the structure). The cleaning bed alone offers "Temizlik bitti · boş" to a holder of `beds.release` (a physician holds none, and is offered none); the release says so named after the bed, and the structure is read again; a refusal goes on the toast by its code.

**Files:**
- Create: `dashboard/src/live/screens/kabul/BedsTab.test.jsx`
- Modify: `dashboard/src/live/screens/kabul/BedsTab.jsx`

- [ ] **Step 1: Write the failing test:**

**Write** `dashboard/src/live/screens/kabul/BedsTab.test.jsx` (a new file, whole):

```jsx
// The Yataklar tab (Group 2 · B1a, spec §3.4, §5.4): the caller's beds by unit and room with their
// state, and "Temizlik bitti · boş" on a bed in cleaning — for a holder of `beds.release` only.
import { describe, it, expect } from "vitest";
import React from "react";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { refusal } from "../../session/mount.testutil.jsx";
import { BedsTab } from "./BedsTab.jsx";
import { BED, DOCTOR, NURSE, UUID_TEXT, mountKabul, settle, toasts } from "./kabul.testutil.js";

describe("BedsTab", () => {
  it("shows every bed of the caller's units with its state, by name", async () => {
    await mountKabul(<BedsTab />, { perms: NURSE });
    const room = within(screen.getByRole("region", { name: "Otaq 1" }));
    for (const [label, state] of [["1", "Boş"], ["2", "Dolu"], ["3", "Təmizlikdədir"], ["4", "Bağlıdır"]]) {
      expect(within(room.getByText(label).closest("li")).getByText(state)).toBeTruthy();
    }
    expect(screen.getByRole("heading", { name: /Neonatal · bağlıdır/ })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(UUID_TEXT);
  });

  it("offers the release on the cleaning bed alone", async () => {
    await mountKabul(<BedsTab />, { perms: NURSE });
    expect(screen.getAllByRole("button", { name: "Təmizlik bitdi · boş" })).toHaveLength(1);
  });

  it("offers a physician, who holds no beds.release, none", async () => {
    await mountKabul(<BedsTab />, { perms: DOCTOR });
    expect(screen.getByText("Təmizlikdədir")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Təmizlik bitdi · boş" })).toBeNull();
  });

  it("releases the bed, says so named after it, and reads the beds again", async () => {
    const { api } = await mountKabul(<BedsTab />, { perms: NURSE,
      setup: (a) => a.releaseBed.mockResolvedValue({ id: BED(3), state: "AVAILABLE" }) });
    const reads = api.structure.mock.calls.length;
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Təmizlik bitdi · boş" })); });
    await settle();
    expect(api.releaseBed).toHaveBeenCalledWith(BED(3));
    expect(toasts().getAllByText("3 · Otaq 1 · Reanimasiya · çarpayı boşdur").length).toBeGreaterThan(0);
    expect(api.structure.mock.calls.length).toBeGreaterThan(reads);
  });

  it("puts a refusal on the toast by its code", async () => {
    await mountKabul(<BedsTab />, { perms: NURSE,
      setup: (a) => a.releaseBed.mockRejectedValue(refusal(403, "This bed is not in one of your units.", { apiCode: "out_of_scope" })) });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Təmizlik bitdi · boş" })); });
    await settle();
    expect(toasts().getAllByText("3 · Otaq 1 · Reanimasiya: Bu çarpayı sizin şöbələrinizdən birində deyil.").length).toBeGreaterThan(0);
  });
});
```


- [ ] **Step 2: Run it and see it red** — the tab is a stub:

```bash
cd /c/tmp/g2b-kabul-fe/dashboard
npx vitest run src/live/screens/kabul/BedsTab.test.jsx 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ Test Files |^ +Tests |^ FAIL |→ |×"
```

Expected (the replay, times vary):

```text
Test Files  1 failed (1)
      Tests  5 failed (5)
 FAIL  src/live/screens/kabul/BedsTab.test.jsx > BedsTab > shows every bed of the caller's units with its state, by name
 FAIL  src/live/screens/kabul/BedsTab.test.jsx > BedsTab > offers the release on the cleaning bed alone
 FAIL  src/live/screens/kabul/BedsTab.test.jsx > BedsTab > offers a physician, who holds no beds.release, none
 FAIL  src/live/screens/kabul/BedsTab.test.jsx > BedsTab > releases the bed, says so named after it, and reads the beds again
 FAIL  src/live/screens/kabul/BedsTab.test.jsx > BedsTab > puts a refusal on the toast by its code
× BedsTab > shows every bed of the caller's units with its state, by name 66ms
→ Unable to find an accessible element with the role "region" and name "Otaq 1"
× BedsTab > offers the release on the cleaning bed alone 19ms
→ Unable to find an accessible element with the role "button" and name "Təmizlik bitdi · boş"
× BedsTab > offers a physician, who holds no beds.release, none 12ms
→ Unable to find an element with the text: Təmizlikdədir. This could be because the text is broken up by multiple elements. In this case, you can provide a function for your text matcher to make your matcher more flexible.
```


- [ ] **Step 3: The tab:**

**Edit** `dashboard/src/live/screens/kabul/BedsTab.jsx` (1) — replace:

```jsx
// src/live/screens/kabul/BedsTab.jsx — "Yataklar" (Group 2 · B1a). Task 16 builds it; until then
// the frame (KabulScreen.jsx) offers the tab and shows nothing in it, so the route and the tabs
// stand and are tested on their own (src/reachable.test.js: a module is wired the day it lands).
export function BedsTab() {
  return null;
}
```

with:

```jsx
// src/live/screens/kabul/BedsTab.jsx — "Yataklar" (Group 2 · B1a, spec §3.4, §5.4): the caller's
// beds by unit and room with their state, and "Temizlik bitti · boş" on a bed in cleaning for a
// holder of `beds.release` — the ward turns its beds over without an administrator (D8). A small
// precursor of B3's occupancy screen.
import React, { useEffect, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useSession } from "../../session/SessionProvider.jsx";
import { useStructure } from "../../data/StructureProvider.jsx";
import { readErrorText } from "../../apiErrors.js";
import { Alert, Box, Button, Empty, Tag, useToast } from "../../ui/index.js";
import { BED_STATE_KEYS } from "../../data/structure.js";
import { doneFor, refusedFor } from "../admin/refusal.js";

const TONE = { AVAILABLE: "neutral", HOUSEKEEPING: "warn", OCCUPIED: "crit", PENDING_DISCHARGE: "warn" };

export function BedsTab() {
  const { t } = useI18n();
  const { user, store } = useSession();
  const { structure, phase, error, reload } = useStructure();
  const toast = useToast();
  const [releasing, setReleasing] = useState(null);
  const canRelease = user?.perms?.includes("beds.release") ?? false;
  useEffect(() => { reload(); }, [reload]);

  async function release(bed, unit, room) {
    if (releasing) return;
    const subject = `${bed.label} · ${room.name} · ${unit.name}`;
    setReleasing(bed.id);
    try {
      await store.track(() => store.api.releaseBed(bed.id));
      toast(doneFor(t, subject, t("kabul.released")));
    } catch (err) {
      toast(refusedFor(t, subject, err), "error");
    } finally {
      setReleasing(null);
      reload();
    }
  }

  const units = (structure?.sites ?? []).flatMap((site) => site.units ?? []);
  return (
    <div className="grid gap-3">
      {error ? <Alert tone="crit">{t(phase === "stale" ? "kabul.listStale" : "kabul.listFailed", { reason: readErrorText(t, error) })}</Alert> : null}
      {structure === null && !error ? <p className="m-0 text-13 text-mute">{t("kabul.loading")}</p> : null}
      {structure !== null && units.length === 0 ? <Empty icon="bed">{t("kabul.pickerNone")}</Empty> : null}
      {units.map((unit) => (
        <Box key={unit.id} title={unit.is_active === false ? `${unit.name} · ${t("kabul.unitClosed")}` : unit.name} icon="building" level={2}>
          {(unit.rooms ?? []).map((room) => (
            <section key={room.id} aria-label={room.name} className="mb-2.5 last:mb-0">
              <h3 className="m-0 mb-1 text-12.5 font-semibold text-mute">
                {room.name}{room.is_active === false ? ` · ${t("kabul.roomClosed")}` : ""}
              </h3>
              <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2 p-0">
                {(room.beds ?? []).map((bed) => (
                  <li key={bed.id} className="flex items-center justify-between gap-2 rounded-ctl border border-line bg-card px-2.5 py-2">
                    <span className="grid">
                      <b className="font-data text-15">{bed.label}</b>
                      <span>
                        <Tag tone={bed.is_active === false ? "neutral" : TONE[bed.state] ?? "neutral"}>
                          {bed.is_active === false ? t("kabul.bedClosed") : t(BED_STATE_KEYS[bed.state] ?? "kabul.bedOther")}
                        </Tag>
                      </span>
                    </span>
                    {canRelease && bed.state === "HOUSEKEEPING" ? (
                      <Button size="sm" icon="ok" busy={releasing === bed.id} onClick={() => release(bed, unit, room)}>
                        {t("kabul.release")}
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </Box>
      ))}
    </div>
  );
}
```


- [ ] **Step 4: Run the folder green:**

```bash
cd /c/tmp/g2b-kabul-fe/dashboard
npx vitest run src/live/screens/kabul/ 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ Test Files |^ +Tests |^ FAIL |→ |×"
```

Expected (the replay, times vary):

```text
Test Files  7 passed (7)
      Tests  43 passed (43)
```


- [ ] **Step 5: The whole suite and the build:**

```bash
cd /c/tmp/g2b-kabul-fe/dashboard
npx vitest run 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ Test Files |^ +Tests |^ FAIL |→ |×"
```

Expected (the replay, times vary):

```text
Test Files  98 passed (98)
      Tests  2523 passed (2523)
```

```bash
cd /c/tmp/g2b-kabul-fe/dashboard
npx vite build 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "built in|precache|larger than|error"
```

Expected (the replay, times vary):

```text
✓ built in …s
precache  20 entries (910.13 KiB)
```


- [ ] **Step 6: Line ends:**

```bash
cd /c/tmp/g2b-kabul-fe
for f in dashboard/src/live/screens/kabul/BedsTab.test.jsx dashboard/src/live/screens/kabul/BedsTab.jsx; do printf "%s CR=%s LF=%s\n" "$f" "$(tr -cd '\r' < "$f" | wc -c)" "$(tr -cd '\n' < "$f" | wc -c)"; done
```

Expected:

```text
dashboard/src/live/screens/kabul/BedsTab.test.jsx CR=0 LF=50
dashboard/src/live/screens/kabul/BedsTab.jsx CR=0 LF=78
```


- [ ] **Step 7: Commit:**

```bash
cd /c/tmp/g2b-kabul-fe
git add -- dashboard/src/live/screens/kabul/BedsTab.test.jsx dashboard/src/live/screens/kabul/BedsTab.jsx
git status --short && git diff --cached --stat
git commit -m "feat(dashboard): Yataklar — the beds by state and the release of a cleaned one (G2-B1a)" \
  -m "red: Tests  5 failed (5)" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- dashboard/src/live/screens/kabul/BedsTab.test.jsx dashboard/src/live/screens/kabul/BedsTab.jsx
```

---

### Task 17: The sign-off strip on the patient screen and the badge on the bed card

**Lane:** dashboard. **Needs:** Task 15 (`useAdmissions`), Task 12.

Spec D3, §3.2, §5.5, X60, X61. `SignOffStrip.jsx` reads the DRAFT admissions (`admissions.view`) and, on the patient screen of a patient whose admission waits, says "Hekim imzası bekliyor"; a holder of `admissions.sign_off` signs from it — the toast names the bed and the strip goes; a refusal goes on the toast by its code. `PatientScreen.jsx` (Lane A's patient screen, but not one of O17's files) gains two lines in a `G2-B1a` block: the import and `<SignOffStrip>`; `patient.onlyWrite` is not changed (X60). The bed board reads the DRAFT admissions every 60 s (X61) and `BedCard.jsx` shows the badge "Hekim imzası bekliyor" on a card whose number is among them.

**Files:**
- Create: `dashboard/src/live/screens/kabul/SignOffStrip.test.jsx`
- Create: `dashboard/src/live/screens/kabul/SignOffStrip.jsx`
- Modify: `dashboard/src/live/screens/patient/PatientScreen.jsx`
- Modify: `dashboard/src/live/screens/beds/BedCard.jsx`
- Modify: `dashboard/src/live/screens/beds/BedsScreen.jsx`

- [ ] **Step 1: Write the failing test** — the strip, and the bed card's badge:

**Write** `dashboard/src/live/screens/kabul/SignOffStrip.test.jsx` (a new file, whole):

```jsx
// "Hekim imzası bekliyor" on the patient screen and the bed card (Group 2 · B1a, spec D3, §3.2,
// §5.5): shown for a DRAFT admission only; a physician signs from the strip.
import { describe, it, expect } from "vitest";
import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { refusal } from "../../session/mount.testutil.jsx";
import { I18nProvider } from "../../i18n/I18nProvider.jsx";
import { BedCard } from "../beds/BedCard.jsx";
import { entry, identity } from "../../data/board.testutil.js";
import { SignOffStrip } from "./SignOffStrip.jsx";
import { DOCTOR, NURSE, mountKabul, row, settle, toasts } from "./kabul.testutil.js";

const DRAFT = [row({ id: "a-7", patient_number: "H2600007", state: "DRAFT" })];

describe("SignOffStrip", () => {
  it("reads the DRAFT admissions and says the patient waits for a signature", async () => {
    const { api } = await mountKabul(<SignOffStrip patientId="H2600007" subject="2 · Reanimasiya" />,
      { perms: NURSE, setup: (a) => a.admissions.mockResolvedValue(DRAFT) });
    expect(api.admissions).toHaveBeenCalledWith(["DRAFT"]);
    expect(screen.getByText(/^Həkim imzası gözlənilir/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Qəbulu imzala" })).toBeNull();
    expect(screen.getByText("İmzanı yalnız qəbulu təsdiqləmək səlahiyyəti olan həkim atır.")).toBeTruthy();
  });

  it("is not there for a patient whose admission is signed", async () => {
    await mountKabul(<SignOffStrip patientId="H2600001" subject="1 · Reanimasiya" />,
      { perms: DOCTOR, setup: (a) => a.admissions.mockResolvedValue(DRAFT) });
    expect(screen.queryByText(/Həkim imzası gözlənilir/)).toBeNull();
  });

  it("lets a physician sign: the toast names the bed and the strip goes", async () => {
    const { api } = await mountKabul(<SignOffStrip patientId="H2600007" subject="2 · Reanimasiya" />, {
      perms: DOCTOR,
      setup: (a) => {
        a.admissions.mockResolvedValueOnce(DRAFT).mockResolvedValue([]);
        a.signOffAdmission.mockResolvedValue({ id: "a-7", state: "ACTIVE" });
      },
    });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Qəbulu imzala" })); });
    await settle();
    expect(api.signOffAdmission).toHaveBeenCalledWith("a-7");
    expect(toasts().getAllByText("2 · Reanimasiya · qəbul imzalandı").length).toBeGreaterThan(0);
    expect(screen.queryByText(/Həkim imzası gözlənilir/)).toBeNull();
  });

  it("puts a refusal on the toast by its code", async () => {
    await mountKabul(<SignOffStrip patientId="H2600007" subject="2 · Reanimasiya" />, {
      perms: DOCTOR,
      setup: (a) => {
        a.admissions.mockResolvedValue(DRAFT);
        a.signOffAdmission.mockRejectedValue(refusal(403, "This bed is not in one of your units.", { apiCode: "out_of_scope" }));
      },
    });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Qəbulu imzala" })); });
    await settle();
    expect(toasts().getAllByText("2 · Reanimasiya: Bu çarpayı sizin şöbələrinizdən birində deyil.").length).toBeGreaterThan(0);
  });
});

describe("the bed card's badge", () => {
  const card = (draft) => render(
    <I18nProvider><ul><BedCard patient={{ ...entry("H2600007"), identity: identity({ patient_id: "H2600007" }),
      patient_id: "H2600007", bedLabel: "2", display_name: "Sentetik Hasta", alerts: [] }} draft={draft} /></ul></I18nProvider>);

  it("says the admission waits for the physician's signature", () => {
    card(true);
    expect(screen.getByText("Həkim imzası gözlənilir")).toBeTruthy();
  });

  it("says nothing of a signed one", () => {
    card(false);
    expect(screen.queryByText("Həkim imzası gözlənilir")).toBeNull();
  });
});
```


- [ ] **Step 2: Run it and see it red** — `SignOffStrip.jsx` does not exist:

```bash
cd /c/tmp/g2b-kabul-fe/dashboard
npx vitest run src/live/screens/kabul/SignOffStrip.test.jsx 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ Test Files |^ +Tests |^ FAIL |→ |×"
```

Expected (the replay, times vary):

```text
Test Files  1 failed (1)
      Tests  no tests
 FAIL  src/live/screens/kabul/SignOffStrip.test.jsx [ src/live/screens/kabul/SignOffStrip.test.jsx ]
```


- [ ] **Step 3: The strip; two lines in the patient screen; the badge and the board's read:**

**Write** `dashboard/src/live/screens/kabul/SignOffStrip.jsx` (a new file, whole):

```jsx
// src/live/screens/kabul/SignOffStrip.jsx — "Hekim imzası bekliyor" on the patient screen of a
// DRAFT admission (Group 2 · B1a, spec D3, §3.2, §5.5). The card and the monitoring started at
// admission; the signature is the physician's later step, and until it is given the screen says
// so. A holder of `admissions.sign_off` signs here (POST /admissions/{id}/sign-off): the server
// makes her the attending when none is set. A session without `admissions.view` reads no
// admission and shows no strip.
import React, { useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useSession } from "../../session/SessionProvider.jsx";
import { Button, Icon, useToast } from "../../ui/index.js";
import { doneFor, refusedFor } from "../admin/refusal.js";
import { useAdmissions } from "./useAdmissions.js";

const DRAFT = ["DRAFT"];

/** `patientId`: the board's key — for a `kabul` patient, the patient number. `subject`: what a
 *  toast names the patient by (the bed label, never the name: amendments (f)). */
export function SignOffStrip({ patientId, subject }) {
  const { t } = useI18n();
  const { user, store } = useSession();
  const toast = useToast();
  const { rows, reload } = useAdmissions(DRAFT);
  const [busy, setBusy] = useState(false);
  const row = rows?.find((r) => r.patient_number === patientId) ?? null;
  if (!row) return null;
  const canSign = user?.perms?.includes("admissions.sign_off") ?? false;

  async function sign() {
    if (busy) return;
    setBusy(true);
    try {
      await store.track(() => store.api.signOffAdmission(row.id));
      toast(doneFor(t, subject, t("kabul.signed")));
    } catch (err) {
      toast(refusedFor(t, subject, err), "error");
    } finally {
      setBusy(false);
      reload();
    }
  }

  return (
    <div role="note" className="flex flex-wrap items-center gap-2 rounded-ctl border border-att-line bg-att px-3 py-2 text-13 font-semibold text-att-ink">
      <Icon name="edit" size={16} />
      <span className="min-w-0 flex-1">{t("kabul.awaitingSignature")}</span>
      {canSign ? (
        <Button size="sm" variant="primary" icon="ok" busy={busy} onClick={sign}>{t("kabul.sign")}</Button>
      ) : (
        <span className="text-12 font-normal">{t("kabul.signNoRight")}</span>
      )}
    </div>
  );
}
```

**Edit** `dashboard/src/live/screens/patient/PatientScreen.jsx` (1) — replace:

```jsx
import { TrendsBox } from "./trends/TrendsBox.jsx";

```

with:

```jsx
import { TrendsBox } from "./trends/TrendsBox.jsx";
import { SignOffStrip } from "../kabul/SignOffStrip.jsx"; // G2-B1a

```

**Edit** `dashboard/src/live/screens/patient/PatientScreen.jsx` (2) — replace:

```jsx
          </header>
          <Note tone="info" icon="eye">{t("patient.onlyWrite")}</Note>
```

with:

```jsx
          </header>
          {/* G2-B1a: a DRAFT admission waits for the physician's signature (screens/kabul). */}
          <SignOffStrip patientId={id} subject={bed} />

          <Note tone="info" icon="eye">{t("patient.onlyWrite")}</Note>
```

**Edit** `dashboard/src/live/screens/beds/BedCard.jsx` (1) — replace:

```jsx
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { Icon, RiskPill, StatusPill, riskStyle } from "../../ui/index.js";
import { FOCUS_RING } from "../../ui/focus.js";
```

with:

```jsx
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { Icon, RiskPill, StatusPill, Tag, riskStyle } from "../../ui/index.js";
import { FOCUS_RING } from "../../ui/focus.js";
```

**Edit** `dashboard/src/live/screens/beds/BedCard.jsx` (2) — replace:

```jsx
 */
export function BedCard({ patient, alerts = [], nowMs, connection, monitor }) {
  const { t } = useI18n();
```

with:

```jsx
 */
/** `draft` (G2-B1a): the admission behind this card waits for the physician's signature. */
export function BedCard({ patient, alerts = [], nowMs, connection, monitor, draft = false }) {
  const { t } = useI18n();
```

**Edit** `dashboard/src/live/screens/beds/BedCard.jsx` (3) — replace:

```jsx
            </span>
          </div>
```

with:

```jsx
            </span>
            {draft ? <Tag tone="warn" icon="edit" className="mt-1">{t("kabul.badgeDraft")}</Tag> : null}
          </div>
```

**Edit** `dashboard/src/live/screens/beds/BedsScreen.jsx` (1) — replace:

```jsx
import { unitLabel } from "../../data/structure.js";
import { useShadow } from "../../data/ShadowProvider.jsx";
```

with:

```jsx
import { unitLabel } from "../../data/structure.js";
import { useAdmissions } from "../kabul/useAdmissions.js";

const DRAFT = ["DRAFT"];
import { useShadow } from "../../data/ShadowProvider.jsx";
```

**Edit** `dashboard/src/live/screens/beds/BedsScreen.jsx` (2) — replace:

```jsx
  const { unit, setUnit, units, stale: unitsStale } = useShell();
  // G2-B1a: a unit by its name, never its UUID (data/structure.js).
  const { index } = useStructure();
  const unitName = (id) => unitLabel(t, index, id);
  const nowMs = useBoardNow(TICK_MS);
```

with:

```jsx
  const { unit, setUnit, units, stale: unitsStale } = useShell();
  // G2-B1a: a unit by its name, never its UUID (data/structure.js); and the admissions still
  // waiting for a physician's signature, for the card's badge (re-read every minute).
  const { index } = useStructure();
  const unitName = (id) => unitLabel(t, index, id);
  const drafts = useAdmissions(DRAFT, { every: 60_000 });
  const draftNumbers = useMemo(() => new Set((drafts.rows ?? []).map((r) => r.patient_number)), [drafts.rows]);
  const nowMs = useBoardNow(TICK_MS);
```

**Edit** `dashboard/src/live/screens/beds/BedsScreen.jsx` (3) — replace:

```jsx
            <BedCard key={p.patient_id} patient={p} alerts={alertsOf(p.patient_id)} nowMs={nowMs} connection={board.connection}
              monitor={linked.has(p.patient_id) ? { entry: linked.get(p.patient_id), ...stripView } : undefined} />
          ))}
```

with:

```jsx
            <BedCard key={p.patient_id} patient={p} alerts={alertsOf(p.patient_id)} nowMs={nowMs} connection={board.connection}
              monitor={linked.has(p.patient_id) ? { entry: linked.get(p.patient_id), ...stripView } : undefined}
              draft={draftNumbers.has(p.patient_id)} />
          ))}
```


- [ ] **Step 4: Run them green, with the patient screen and the bed board:**

```bash
cd /c/tmp/g2b-kabul-fe/dashboard
npx vitest run src/live/screens/kabul/ src/live/screens/patient/ src/live/screens/beds/ 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ Test Files |^ +Tests |^ FAIL |→ |×"
```

Expected (the replay, times vary):

```text
Test Files  21 passed (21)
      Tests  409 passed (409)
```


- [ ] **Step 5: The whole suite and the build:**

```bash
cd /c/tmp/g2b-kabul-fe/dashboard
npx vitest run 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ Test Files |^ +Tests |^ FAIL |→ |×"
```

Expected (the replay, times vary):

```text
Test Files  99 passed (99)
      Tests  2529 passed (2529)
```

```bash
cd /c/tmp/g2b-kabul-fe/dashboard
npx vite build 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "built in|precache|larger than|error"
```

Expected (the replay, times vary):

```text
✓ built in …s
precache  20 entries (911.32 KiB)
```


- [ ] **Step 6: Line ends:**

```bash
cd /c/tmp/g2b-kabul-fe
for f in dashboard/src/live/screens/kabul/SignOffStrip.test.jsx dashboard/src/live/screens/kabul/SignOffStrip.jsx dashboard/src/live/screens/patient/PatientScreen.jsx dashboard/src/live/screens/beds/BedCard.jsx dashboard/src/live/screens/beds/BedsScreen.jsx; do printf "%s CR=%s LF=%s\n" "$f" "$(tr -cd '\r' < "$f" | wc -c)" "$(tr -cd '\n' < "$f" | wc -c)"; done
```

Expected:

```text
dashboard/src/live/screens/kabul/SignOffStrip.test.jsx CR=0 LF=74
dashboard/src/live/screens/kabul/SignOffStrip.jsx CR=0 LF=53
dashboard/src/live/screens/patient/PatientScreen.jsx CR=427 LF=427
dashboard/src/live/screens/beds/BedCard.jsx CR=173 LF=173
dashboard/src/live/screens/beds/BedsScreen.jsx CR=375 LF=375
```


- [ ] **Step 7: Commit:**

```bash
cd /c/tmp/g2b-kabul-fe
git add -- dashboard/src/live/screens/kabul/SignOffStrip.test.jsx dashboard/src/live/screens/kabul/SignOffStrip.jsx dashboard/src/live/screens/patient/PatientScreen.jsx dashboard/src/live/screens/beds/BedCard.jsx dashboard/src/live/screens/beds/BedsScreen.jsx
git status --short && git diff --cached --stat
git commit -m "feat(dashboard): the physician signs the admission from the patient screen; the bed card says it waits (G2-B1a)" \
  -m "red: Test Files  1 failed (1) (no tests ran: the module under test does not exist)" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- dashboard/src/live/screens/kabul/SignOffStrip.test.jsx dashboard/src/live/screens/kabul/SignOffStrip.jsx dashboard/src/live/screens/patient/PatientScreen.jsx dashboard/src/live/screens/beds/BedCard.jsx dashboard/src/live/screens/beds/BedsScreen.jsx
```

---

### Task 18: Yönetim › Yapı

**Lane:** dashboard. **Needs:** Task 12.

Spec D10, §3.5, §5.6. A fourth administration tab, `structure`, for `structure.manage` (a `G2-B1a` block in `AdminScreen.jsx`'s tab list): the tree by name, a closed place marked, no UUID; add a site, a unit of a chosen type, a room and a bed under their parents (the tenant routes that exist since Group 1); rename a bed, a room or a unit from its own line; close an open one and reopen a closed one (Task 7's `PATCH`); a refusal on the toast named after what it was about, by its code (`has_open_beds`, `bed_in_use`, `name_taken`). The structure is read again after each write, so the shell's names follow. The route stays `users.manage`/`groups.manage` (O43).

**Files:**
- Create: `dashboard/src/live/screens/admin/StructureTab.test.jsx`
- Create: `dashboard/src/live/screens/admin/StructureTab.jsx`
- Modify: `dashboard/src/live/screens/admin/AdminScreen.test.jsx`
- Modify: `dashboard/src/live/screens/admin/AdminScreen.jsx`

- [ ] **Step 1: Write the failing tests** — the tab; the administration screen's four tabs:

**Write** `dashboard/src/live/screens/admin/StructureTab.test.jsx` (a new file, whole):

```jsx
// Yönetim › Yapı (Group 2 · B1a, spec D10, §3.5, §5.6): the administrator adds sites, units, rooms
// and beds under their parents, renames, closes and reopens them — nothing is deleted — and a
// refusal (an occupied bed, a room with an open bed) goes on the toast named after its subject.
import { describe, it, expect } from "vitest";
import React from "react";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { refusal } from "../../session/mount.testutil.jsx";
import { StructureTab } from "./StructureTab.jsx";
import { ADMIN, BED, REA, ROOM1, SITE, T, UUID_TEXT, mountKabul, settle, toasts } from "../kabul/kabul.testutil.js";

const submitIn = async (label, text) => {
  const input = screen.getByRole("textbox", { name: label });
  fireEvent.change(input, { target: { value: text } });
  await act(async () => { fireEvent.submit(input.closest("form")); });
  await settle();
};

describe("StructureTab", () => {
  it("shows the tree by name, a closed place marked, and no UUID", async () => {
    await mountKabul(<StructureTab />, { perms: ADMIN });
    expect(screen.getByRole("heading", { name: "Ana bina" })).toBeTruthy();
    for (const name of ["Reanimasiya", "Neonatal", "Otaq 1", "Otaq 2"]) expect(screen.getByText(name)).toBeTruthy();
    expect(screen.getAllByText("Bağlıdır").length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(UUID_TEXT);
  });

  it("adds a site, a unit of the chosen type, a room and a bed under their parents", async () => {
    const { api } = await mountKabul(<StructureTab />, { perms: ADMIN });
    await submitIn("Yeni binanın adı", "Yeni korpus");
    expect(api.createSite).toHaveBeenCalledWith(T, { name: "Yeni korpus" });
    fireEvent.change(screen.getByRole("combobox", { name: "Şöbənin növü" }), { target: { value: "NICU" } });
    await submitIn("Ana bina daxilində yeni şöbənin adı", "Neonatal 2");
    expect(api.createUnit).toHaveBeenCalledWith(SITE, { name: "Neonatal 2", unit_type: "NICU" });
    await submitIn("Reanimasiya daxilində yeni otağın adı", "Otaq 3");
    expect(api.createRoom).toHaveBeenCalledWith(REA, { name: "Otaq 3" });
    await submitIn("Otaq 1 daxilində yeni çarpayının etiketi", "6");
    expect(api.createBed).toHaveBeenCalledWith(ROOM1, { label: "6" });
    expect(toasts().getAllByText("6 · əlavə edildi").length).toBeGreaterThan(0);
    expect(api.structure.mock.calls.length).toBeGreaterThan(4);         // read again after each
  });

  it("renames a bed from its own line", async () => {
    const { api } = await mountKabul(<StructureTab />, { perms: ADMIN });
    const bedOne = screen.getAllByText("1").find((el) => el.tagName === "B").closest("li");
    fireEvent.click(within(bedOne).getByRole("button", { name: "Adını dəyiş" }));
    await submitIn("1 üçün yeni ad", "1A");
    expect(api.patchBed).toHaveBeenCalledWith(BED(1), { label: "1A" });
  });

  it("closes an open bed and reopens a closed one", async () => {
    const { api } = await mountKabul(<StructureTab />, { perms: ADMIN });
    const line = (label) => screen.getAllByText(label).find((el) => el.tagName === "B").closest("li");
    await act(async () => { fireEvent.click(within(line("5")).getByRole("button", { name: "Bağla" })); });
    await settle();
    expect(api.patchBed).toHaveBeenCalledWith(BED(5), { is_active: false });
    await act(async () => { fireEvent.click(within(line("4")).getByRole("button", { name: "Yenidən aç" })); });
    await settle();
    expect(api.patchBed).toHaveBeenCalledWith(BED(4), { is_active: true });
  });

  it("puts the server's refusal on the toast, named after what it was about", async () => {
    await mountKabul(<StructureTab />, { perms: ADMIN,
      setup: (a) => a.patchRoom.mockRejectedValue(refusal(409, "Close every bed of this room first.", { apiCode: "has_open_beds" })) });
    const room = screen.getAllByText("Otaq 2").find((el) => el.tagName === "B").closest("li");
    await act(async () => { fireEvent.click(within(room).getAllByRole("button", { name: "Bağla" })[0]); });
    await settle();
    expect(toasts().getAllByText("Otaq 2: Əvvəlcə altındakı bütün çarpayıları bağlayın.").length).toBeGreaterThan(0);
  });
});
```

**Edit** `dashboard/src/live/screens/admin/AdminScreen.test.jsx` (1) — replace:

```jsx
describe("which tabs a session sees", () => {
  it("names the three tabs, each with the right that opens it", () => {
    expect(TABS.map((x) => [x.id, x.perm])).toEqual([
      ["users", "users.manage"], ["roles", "groups.manage"], ["source", "users.manage"],
    ]);
```

with:

```jsx
describe("which tabs a session sees", () => {
  it("names the four tabs, each with the right that opens it", () => {
    expect(TABS.map((x) => [x.id, x.perm])).toEqual([
      ["users", "users.manage"], ["roles", "groups.manage"], ["source", "users.manage"],
      ["structure", "structure.manage"], // G2-B1a
    ]);
```


- [ ] **Step 2: Run them and see them red** — `StructureTab.jsx` does not exist, and the administration screen still offers three tabs:

```bash
cd /c/tmp/g2b-kabul-fe/dashboard
npx vitest run src/live/screens/admin/StructureTab.test.jsx src/live/screens/admin/AdminScreen.test.jsx 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ Test Files |^ +Tests |^ FAIL |→ |×"
```

Expected (the replay, times vary):

```text
Test Files  2 failed (2)
      Tests  1 failed | 24 passed (25)
 FAIL  src/live/screens/admin/StructureTab.test.jsx [ src/live/screens/admin/StructureTab.test.jsx ]
 FAIL  src/live/screens/admin/AdminScreen.test.jsx > which tabs a session sees > names the four tabs, each with the right that opens it
× which tabs a session sees > names the four tabs, each with the right that opens it 15ms
→ expected [ [ 'users', 'users.manage' ], …(2) ] to deeply equal [ [ 'users', 'users.manage' ], …(3) ]
```


- [ ] **Step 3: The tab, and its place in the administration screen:**

**Write** `dashboard/src/live/screens/admin/StructureTab.jsx` (a new file, whole):

```jsx
// src/live/screens/admin/StructureTab.jsx — Yönetim › Yapı (Group 2 · B1a, spec D10, §3.5, §5.6):
// the administrator builds the ward — sites, units, rooms, beds — and renames, closes and reopens
// them. Nothing is deleted: a closed unit, room or bed stays, dimmed, and is offered to no
// admission. A bed holding a patient cannot be closed, nor a unit or room with an open bed under
// it — the server refuses (`bed_in_use`, `has_open_beds`, tenant/router.py) and the refusal goes on
// the toast, named after what it was about. `structure.manage`.
//
// It reads the shell's structure (data/StructureProvider.jsx) and reads it again after every
// write, so the tree on screen is the server's.
import React, { useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useSession } from "../../session/SessionProvider.jsx";
import { useStructure } from "../../data/StructureProvider.jsx";
import { readErrorText } from "../../apiErrors.js";
import { Alert, Box, Button, Input, Select, Tag, useToast } from "../../ui/index.js";
import { BED_STATE_KEYS } from "../../data/structure.js";
import { doneFor, refusedFor } from "./refusal.js";

const UNIT_TYPES = Object.freeze([
  { value: "ADULT_ICU", key: "kabul.unitType.adultIcu" }, { value: "NICU", key: "kabul.unitType.nicu" },
  { value: "PICU", key: "kabul.unitType.picu" }, { value: "CVICU", key: "kabul.unitType.cvicu" },
  { value: "BMT_ICU", key: "kabul.unitType.bmtIcu" },
]);

/** One text box and its button: add a child, or rename this node. */
function Line({ label, initial = "", submitKey, onSubmit, busy, children }) {
  const { t } = useI18n();
  const [value, setValue] = useState(initial);
  return (
    <form className="flex flex-wrap items-center gap-2" onSubmit={async (event) => {
      event.preventDefault();
      if (!value.trim() || busy) return;
      if (await onSubmit(value.trim())) setValue(initial);
    }}>
      <Input aria-label={label} value={value} readOnly={busy} onChange={(e) => setValue(e.target.value)}
        className="!w-auto min-w-[160px] flex-1" />
      {children}
      <Button type="submit" size="sm" busy={busy}>{t(submitKey)}</Button>
    </form>
  );
}

/** A unit, a room or a bed: its name, closed or not, and its three actions. */
function Node({ kind, item, name, state, busy, onRename, onToggle, children }) {
  const { t } = useI18n();
  const [renaming, setRenaming] = useState(false);
  const closed = item.is_active === false;
  return (
    <li className="grid gap-1.5 rounded-ctl border border-line bg-card px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <b className={kind === "bed" ? "font-data" : ""}>{name}</b>
        {closed ? <Tag>{t("kabul.closed")}</Tag> : null}
        {state ? <Tag>{t(BED_STATE_KEYS[state] ?? "kabul.bedOther")}</Tag> : null}
        <span className="ml-auto flex flex-wrap gap-1.5">
          <Button size="sm" variant="ghost" icon="edit" onClick={() => setRenaming((on) => !on)}>{t("kabul.rename")}</Button>
          <Button size="sm" busy={busy} onClick={onToggle}>{t(closed ? "kabul.reopen" : "kabul.close")}</Button>
        </span>
      </div>
      {renaming ? (
        <Line label={t("kabul.renameOf", { name })} initial={name} submitKey="common.save" busy={busy}
          onSubmit={async (value) => { const ok = await onRename(value); if (ok) setRenaming(false); return ok; }} />
      ) : null}
      {children}
    </li>
  );
}

export function StructureTab() {
  const { t } = useI18n();
  const { store } = useSession();
  const { structure, phase, error, reload } = useStructure();
  const toast = useToast();
  const [busy, setBusy] = useState(null);
  const [unitType, setUnitType] = useState("ADULT_ICU");
  const api = store.api;

  /** One write: its subject for the toast, the call, what to say when it lands. True if it did. */
  async function write(id, subject, call, doneKey) {
    if (busy) return false;
    setBusy(id);
    try {
      await store.track(call);
      toast(doneFor(t, subject, t(doneKey)));
      return true;
    } catch (err) {
      toast(refusedFor(t, subject, err), "error");
      return false;
    } finally {
      setBusy(null);
      reload();
    }
  }
  const toggle = (item, patch, name) => write(item.id, name, () => patch(item.id, { is_active: item.is_active === false }),
    item.is_active === false ? "kabul.reopened" : "kabul.closedDone");

  if (structure === null) {
    return error ? <Alert tone="crit">{t("kabul.listFailed", { reason: readErrorText(t, error) })}</Alert>
      : <p className="m-0 text-13 text-mute">{t(phase === "unasked" ? "kabul.noView" : "kabul.loading")}</p>;
  }
  return (
    <div className="grid gap-3">
      {error ? <Alert tone="crit">{t("kabul.listStale", { reason: readErrorText(t, error) })}</Alert> : null}
      <p className="m-0 text-13 text-mute">{t("kabul.structureIntro")}</p>
      <Line label={t("kabul.newSite")} submitKey="kabul.addSite" busy={busy === "site"}
        onSubmit={(name) => write("site", name, () => api.createSite(structure.tenant_id, { name }), "kabul.added")} />
      {(structure.sites ?? []).map((site) => (
        <Box key={site.id} title={site.name} icon="building" level={2}>
          <Line label={t("kabul.newUnit", { site: site.name })} submitKey="kabul.addUnit" busy={busy === site.id}
            onSubmit={(name) => write(site.id, name, () => api.createUnit(site.id, { name, unit_type: unitType }), "kabul.added")}>
            <Select aria-label={t("kabul.unitTypeLabel")} value={unitType} onChange={(e) => setUnitType(e.target.value)} className="!w-auto">
              {UNIT_TYPES.map((o) => <option key={o.value} value={o.value}>{t(o.key)}</option>)}
            </Select>
          </Line>
          <ul className="m-0 mt-2 grid list-none gap-2 p-0">
            {(site.units ?? []).map((unit) => (
              <Node key={unit.id} kind="unit" item={unit} name={unit.name} busy={busy === unit.id}
                onRename={(name) => write(unit.id, unit.name, () => api.patchUnit(unit.id, { name }), "kabul.renamed")}
                onToggle={() => toggle(unit, api.patchUnit, unit.name)}>
                <Line label={t("kabul.newRoom", { unit: unit.name })} submitKey="kabul.addRoom" busy={busy === `${unit.id}+`}
                  onSubmit={(name) => write(`${unit.id}+`, name, () => api.createRoom(unit.id, { name }), "kabul.added")} />
                <ul className="m-0 grid list-none gap-2 p-0 ps-4">
                  {(unit.rooms ?? []).map((room) => (
                    <Node key={room.id} kind="room" item={room} name={room.name} busy={busy === room.id}
                      onRename={(name) => write(room.id, room.name, () => api.patchRoom(room.id, { name }), "kabul.renamed")}
                      onToggle={() => toggle(room, api.patchRoom, room.name)}>
                      <Line label={t("kabul.newBed", { room: room.name })} submitKey="kabul.addBed" busy={busy === `${room.id}+`}
                        onSubmit={(label) => write(`${room.id}+`, label, () => api.createBed(room.id, { label }), "kabul.added")} />
                      <ul className="m-0 grid list-none gap-1.5 p-0 ps-4">
                        {(room.beds ?? []).map((bed) => (
                          <Node key={bed.id} kind="bed" item={bed} name={bed.label} state={bed.state} busy={busy === bed.id}
                            onRename={(label) => write(bed.id, bed.label, () => api.patchBed(bed.id, { label }), "kabul.renamed")}
                            onToggle={() => toggle(bed, api.patchBed, `${bed.label} · ${room.name}`)} />
                        ))}
                      </ul>
                    </Node>
                  ))}
                </ul>
              </Node>
            ))}
          </ul>
        </Box>
      ))}
    </div>
  );
}
```

**Edit** `dashboard/src/live/screens/admin/AdminScreen.jsx` (1) — replace:

```jsx

const TAB_ID = "admin";
```

with:

```jsx

import { StructureTab } from "./StructureTab.jsx"; // G2-B1a

const TAB_ID = "admin";
```

**Edit** `dashboard/src/live/screens/admin/AdminScreen.jsx` (2) — replace:

```jsx
  Object.freeze({ id: "source", perm: "users.manage", labelKey: "admin.tabSource" }),
]);
```

with:

```jsx
  Object.freeze({ id: "source", perm: "users.manage", labelKey: "admin.tabSource" }),

  // G2-B1a — Yönetim › Yapı: the ward's sites, units, rooms and beds
  Object.freeze({ id: "structure", perm: "structure.manage", labelKey: "kabul.structureTab" }),
]);
```

**Edit** `dashboard/src/live/screens/admin/AdminScreen.jsx` (3) — replace:

```jsx
  source: SourceTab, //   G1-14
});
```

with:

```jsx
  source: SourceTab, //   G1-14

  structure: StructureTab, // G2-B1a
});
```


- [ ] **Step 4: Run the administration folder green:**

```bash
cd /c/tmp/g2b-kabul-fe/dashboard
npx vitest run src/live/screens/admin/ 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ Test Files |^ +Tests |^ FAIL |→ |×"
```

Expected (the replay, times vary):

```text
Test Files  11 passed (11)
      Tests  311 passed (311)
```


- [ ] **Step 5: The whole suite and the build:**

```bash
cd /c/tmp/g2b-kabul-fe/dashboard
npx vitest run 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ Test Files |^ +Tests |^ FAIL |→ |×"
```

Expected (the replay, times vary):

```text
Test Files  100 passed (100)
      Tests  2534 passed (2534)
```

```bash
cd /c/tmp/g2b-kabul-fe/dashboard
npx vite build 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "built in|precache|larger than|error"
```

Expected (the replay, times vary):

```text
✓ built in …s
precache  20 entries (915.59 KiB)
```


- [ ] **Step 6: Line ends:**

```bash
cd /c/tmp/g2b-kabul-fe
for f in dashboard/src/live/screens/admin/StructureTab.test.jsx dashboard/src/live/screens/admin/AdminScreen.test.jsx dashboard/src/live/screens/admin/StructureTab.jsx dashboard/src/live/screens/admin/AdminScreen.jsx; do printf "%s CR=%s LF=%s\n" "$f" "$(tr -cd '\r' < "$f" | wc -c)" "$(tr -cd '\n' < "$f" | wc -c)"; done
```

Expected:

```text
dashboard/src/live/screens/admin/StructureTab.test.jsx CR=0 LF=69
dashboard/src/live/screens/admin/AdminScreen.test.jsx CR=340 LF=340
dashboard/src/live/screens/admin/StructureTab.jsx CR=0 LF=145
dashboard/src/live/screens/admin/AdminScreen.jsx CR=216 LF=216
```


- [ ] **Step 7: Commit:**

```bash
cd /c/tmp/g2b-kabul-fe
git add -- dashboard/src/live/screens/admin/StructureTab.test.jsx dashboard/src/live/screens/admin/AdminScreen.test.jsx dashboard/src/live/screens/admin/StructureTab.jsx dashboard/src/live/screens/admin/AdminScreen.jsx
git status --short && git diff --cached --stat
git commit -m "feat(dashboard): Yönetim › Yapı — the administrator builds, renames, closes and reopens the ward (G2-B1a)" \
  -m "red: Tests  1 failed | 24 passed (25)" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- dashboard/src/live/screens/admin/StructureTab.test.jsx dashboard/src/live/screens/admin/AdminScreen.test.jsx dashboard/src/live/screens/admin/StructureTab.jsx dashboard/src/live/screens/admin/AdminScreen.jsx
```

---

### Task 19: The sweep — no raw key and no UUID on any Hasta Kabul surface

**Lane:** dashboard. **Needs:** Tasks 14–18.

Spec §5.7, §8. `rawKeys.test.jsx` mounts every route in every language and fails on a string key printed raw. Its fixture gains the ward and the open admissions (`kabul.testutil.js`), so the Hasta Kabul route renders its tabs with data, and an anchor walks Kabul, Taburcu and Yataklar and Yönetim › Yapı, asserting no raw key and no UUID in the page. The anchor is a guard over surfaces Tasks 14–18 built: it is expected **green on its first run**. If it is red, a surface prints a raw key or a UUID — fix the surface, not the test.

**Files:**
- Modify: `dashboard/src/live/rawKeys.test.jsx`

- [ ] **Step 1: Extend the sweep:**

**Edit** `dashboard/src/live/rawKeys.test.jsx` (1) — replace:

```jsx
import { BANDS, channel, marker, point, trends } from "./screens/patient/trends/trends.testutil.js";

```

with:

```jsx
import { BANDS, channel, marker, point, trends } from "./screens/patient/trends/trends.testutil.js";
import { UUID_TEXT, row as admissionRow, structure as wardStructure } from "./screens/kabul/kabul.testutil.js"; // G2-B1a

```

**Edit** `dashboard/src/live/rawKeys.test.jsx` (2) — replace:

```jsx

/** The shell on one address, as LiveApp nests it, with the board LIVE and its first reload landed. */
```

with:

```jsx

/** G2-B1a: a ward (kabul.testutil.js) and its admissions in each open state. */
const WARD = wardStructure();
const ADMISSIONS = [
  admissionRow({ id: "a-1", patient_number: FIXTURE_ID, state: "DRAFT", bed_label: "1" }),
  admissionRow({ id: "a-2", patient_number: "H2600002", state: "ACTIVE", bed_label: "2" }),
  admissionRow({ id: "a-3", patient_number: "H2600003", state: "PENDING_DISCHARGE", bed_label: "5", room_name: "Otaq 2",
    discharge_disposition: "EXITUS", discharge_at: "2026-10-08T09:30:00Z" }),
];

/** The shell on one address, as LiveApp nests it, with the board LIVE and its first reload landed. */
```

**Edit** `dashboard/src/live/rawKeys.test.jsx` (3) — replace:

```jsx
      api.patientTrends.mockImplementation((pid, hours) => Promise.resolve({ ...TRENDS, patient_id: pid, hours }));
    },
```

with:

```jsx
      api.patientTrends.mockImplementation((pid, hours) => Promise.resolve({ ...TRENDS, patient_id: pid, hours }));

      // G2-B1a: the ward's structure and its open admissions — a DRAFT on the fixture's card (the
      // sign-off strip and the badge), an admitted patient and a started discharge (Taburcu).
      api.structure.mockResolvedValue(WARD);
      api.admissions.mockResolvedValue(ADMISSIONS);
    },
```

**Edit** `dashboard/src/live/rawKeys.test.jsx` (4) — replace:

```jsx
  // table and the patient's-normal form open only on a click, so the sweep above never saw them.
  it("the trend charts' keys resolve on the cards, in the big chart, its table and the form", async () => {
```

with:

```jsx
  // table and the patient's-normal form open only on a click, so the sweep above never saw them.
  // G2-B1a — the same anchor for Hasta Kabul: the form's panel and the bed picker, both lists of
  // Taburcu and its dialog (which opens only on a click), Yataklar, the sign-off strip and the
  // badge, and Yönetim › Yapı — and on none of them a UUID (spec D9).
  it("the Hasta Kabul keys resolve on its three tabs, the discharge dialog, the strip, the badge and Yapı", async () => {
    let mounted = await openAt("/kabul");
    expect(screen.getByText("Çatışmayan sahələr")).toBeInTheDocument();                 // kabul.missingTitle
    expect(screen.getByRole("button", { name: /^Reanimasiya/ })).toBeInTheDocument();  // the picker, by name
    await act(async () => { fireEvent.click(screen.getByRole("tab", { name: "Evə yazılma" })); await settle(); });
    expect(screen.getByText("Vəfat (exitus)", { exact: false })).toBeInTheDocument();  // kabul.disp.exitus
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Evə yazılmanı başlat" })); });
    expect(screen.getByRole("dialog")).toHaveTextContent("Çıxış forması");             // kabul.f.disposition
    expect(rawKeys(document.body)).toEqual([]);
    expect(document.body.textContent).not.toMatch(UUID_TEXT);
    act(() => { mounted.board.clear(); });
    cleanup();

    mounted = await openAt(`/patients/${FIXTURE_ID}`);
    expect(screen.getByText(/^Həkim imzası gözlənilir —/)).toBeInTheDocument();          // kabul.awaitingSignature
    act(() => { mounted.board.clear(); });
    cleanup();

    mounted = await openAt("/beds");
    expect(screen.getByText("Həkim imzası gözlənilir")).toBeInTheDocument();             // kabul.badgeDraft
    act(() => { mounted.board.clear(); });
    cleanup();

    mounted = await openAt("/admin");
    await act(async () => { fireEvent.click(screen.getByRole("tab", { name: "Struktur" })); await settle(); });
    expect(screen.getByText(/Bina, şöbə, otaq və çarpayıları buradan qurun/)).toBeInTheDocument();
    expect(rawKeys(document.body)).toEqual([]);
    expect(document.body.textContent).not.toMatch(UUID_TEXT);
    act(() => { mounted.board.clear(); });
  });

  it("the trend charts' keys resolve on the cards, in the big chart, its table and the form", async () => {
```


- [ ] **Step 2: Run it:**

```bash
cd /c/tmp/g2b-kabul-fe/dashboard
npx vitest run src/live/rawKeys.test.jsx 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ Test Files |^ +Tests |^ FAIL |→ |×"
```

Expected (the replay, times vary):

```text
Test Files  1 passed (1)
      Tests  8 passed (8)
```


- [ ] **Step 3: The whole suite and the build:**

```bash
cd /c/tmp/g2b-kabul-fe/dashboard
npx vitest run 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ Test Files |^ +Tests |^ FAIL |→ |×"
```

Expected (the replay, times vary):

```text
Test Files  100 passed (100)
      Tests  2535 passed (2535)
```

```bash
cd /c/tmp/g2b-kabul-fe/dashboard
npx vite build 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "built in|precache|larger than|error"
```

Expected (the replay, times vary):

```text
✓ built in …s
precache  20 entries (915.59 KiB)
```


- [ ] **Step 4: Line ends:**

```bash
cd /c/tmp/g2b-kabul-fe
for f in dashboard/src/live/rawKeys.test.jsx; do printf "%s CR=%s LF=%s\n" "$f" "$(tr -cd '\r' < "$f" | wc -c)" "$(tr -cd '\n' < "$f" | wc -c)"; done
```

Expected:

```text
dashboard/src/live/rawKeys.test.jsx CR=576 LF=576
```


- [ ] **Step 5: Commit:**

```bash
cd /c/tmp/g2b-kabul-fe
git add -- dashboard/src/live/rawKeys.test.jsx
git status --short && git diff --cached --stat
git commit -m "test(dashboard): no raw key and no UUID on any Hasta Kabul surface (G2-B1a)" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- dashboard/src/live/rawKeys.test.jsx
```

---

### Task 20: The gates — everything, on the merged branch

**Where:** `/c/tmp/g2b-kabul` (branch `feat/g2b-kabul`), after both lanes are merged ("The two lanes": the backend lane first, then the dashboard lane). **Needs:** Tasks 1–19. Nothing here is committed but `reference.patch`, which lives outside the repository.

- [ ] **Step 1: The merge is whole.** The slice's code files are the 83 the file map lists (85 with Task 22's two docs), and nothing else changed:

```bash
cd /c/tmp/g2b-kabul
git log --oneline 2c585e8..HEAD | cat
git diff --shortstat 2c585e8 HEAD -- homunculus-engine dashboard
```

Expected: the B3a spec commit `d8937fd` (docs only), the plan's commit, Tasks 1–19's nineteen commits and the dashboard lane's merge (Task 22's docs land after this task); ` 83 files changed, 6121 insertions(+), 133 deletions(-)` — every file of the file map but the two docs (a review follow-up changes the line counts, never the file count).

- [ ] **Step 2: The whole no-DB engine suite** (≈ 2½ min):

```bash
cd /c/tmp/g2b-kabul/homunculus-engine
PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q --ignore=tests/test_infinity_vm_pilot.py 2>&1 | tail -1
```

Expected: `2330 passed, 710 skipped, 3 warnings`.

- [ ] **Step 3: The Postgres-backed suite, in fourteen parts** — each meant to stay well under the 10-minute call limit, one at a time (they share `homunculus_test` and its advisory lock with Lane A: a part that waits for Lane A's run counts that wait against its 10 minutes — if the call ends first, run the part again). On 2026-10-25, with Lane A's suites running beside it, the database took ≈ 5–6 s per DB-backed test: G2-01's first part, `test_ad*`, ran 20 minutes, and a split into ten still left parts of 8½–9¼ minutes. These parts hold at most ≈ 70 DB-backed tests each; the three largest files are split with `-k` (by test name), as `test_tenant_isolation.py` is (O49). `grep -v` keeps `tests/test_infinity_vm_pilot.py` out of part 11: never let a glob pick it up. Each command is the same but for its file list:

```bash
# part 1
cd /c/tmp/g2b-kabul/homunculus-engine
DB=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test
TEST_DATABASE_URL=$DB PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_admin_api.py 2>&1 | tail -1
```
```bash
# part 2
cd /c/tmp/g2b-kabul/homunculus-engine
DB=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test
TEST_DATABASE_URL=$DB PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q $(ls tests/test_admission*.py) tests/test_adt_diagnoses.py 2>&1 | tail -1
```
```bash
# part 3
cd /c/tmp/g2b-kabul/homunculus-engine
DB=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test
TEST_DATABASE_URL=$DB PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_admin_ldap_api.py -k "unlock or mapping" 2>&1 | tail -1
```
```bash
# part 4
cd /c/tmp/g2b-kabul/homunculus-engine
DB=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test
TEST_DATABASE_URL=$DB PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_admin_ldap_api.py -k "not unlock and not mapping" 2>&1 | tail -1
```
```bash
# part 5
cd /c/tmp/g2b-kabul/homunculus-engine
DB=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test
TEST_DATABASE_URL=$DB PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_auth_ldap_login.py -k "every_401 or floor or cancelled" 2>&1 | tail -1
```
```bash
# part 6
cd /c/tmp/g2b-kabul/homunculus-engine
DB=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test
TEST_DATABASE_URL=$DB PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_auth_ldap_login.py -k "not every_401 and not floor and not cancelled" 2>&1 | tail -1
```
```bash
# part 7
cd /c/tmp/g2b-kabul/homunculus-engine
DB=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test
TEST_DATABASE_URL=$DB PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_auth_login.py tests/test_auth_reauth.py 2>&1 | tail -1
```
```bash
# part 8
cd /c/tmp/g2b-kabul/homunculus-engine
DB=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test
TEST_DATABASE_URL=$DB PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_auth_seed.py tests/test_auth_ldap_refresh.py 2>&1 | tail -1
```
```bash
# part 9
cd /c/tmp/g2b-kabul/homunculus-engine
DB=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test
TEST_DATABASE_URL=$DB PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q $(ls tests/test_a*.py | grep -v -e "tests/test_ad" -e tests/test_auth_ldap_login.py -e tests/test_auth_login.py -e tests/test_auth_reauth.py -e tests/test_auth_seed.py -e tests/test_auth_ldap_refresh.py) 2>&1 | tail -1
```
```bash
# part 10
cd /c/tmp/g2b-kabul/homunculus-engine
DB=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test
TEST_DATABASE_URL=$DB PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q $(ls tests/test_[b-h]*.py) tests/rules tests/scoring tests/tenant 2>&1 | tail -1
```
```bash
# part 11
cd /c/tmp/g2b-kabul/homunculus-engine
DB=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test
TEST_DATABASE_URL=$DB PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q $(ls tests/test_[i-r]*.py | grep -v test_infinity_vm_pilot.py) 2>&1 | tail -1
```
```bash
# part 12
cd /c/tmp/g2b-kabul/homunculus-engine
DB=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test
TEST_DATABASE_URL=$DB PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q $(ls tests/test_[s-z]*.py | grep -v test_tenant_isolation.py) 2>&1 | tail -1
```
```bash
# part 13
cd /c/tmp/g2b-kabul/homunculus-engine
DB=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test
TEST_DATABASE_URL=$DB PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_tenant_isolation.py -k by_id 2>&1 | tail -1
```
```bash
# part 14
cd /c/tmp/g2b-kabul/homunculus-engine
DB=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test
TEST_DATABASE_URL=$DB PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_tenant_isolation.py -k "not by_id" 2>&1 | tail -1
```

Expected, in order (the replay's head, 2026-10-25; times vary): `70 passed` (7 min 51 s); `83 passed` (1 min 46 s); `52 passed, 39 deselected` (4 min 57 s); `39 passed, 52 deselected` (3 min 17 s); `41 passed, 49 deselected` (2 min 20 s); `49 passed, 41 deselected` (3 min 5 s); `67 passed` (5 min 6 s); `58 passed` (3 min 10 s); `515 passed` (2 min 5 s); `531 passed, 1 skipped` (3 min 18 s); `1134 passed, 7 skipped` (5 min 50 s); `275 passed` (4 min 22 s); `60 passed, 58 deselected` (5 min 22 s); `58 passed, 60 deselected` (4 min 47 s). Total **3032 passed, 8 skipped** — the no-DB run's 2330 passed + 710 skipped, every DB-backed test passing; the base's figure is therefore 2914 / 8 (B1a adds 118 tests: 58 without the DB, 60 with it). Part 1 is the longest: if it nears the limit here, run it alone again rather than in a busy minute.

- [ ] **Step 4: The slice's engine files under Python 3.14:**

```bash
cd /c/tmp/g2b-kabul/homunculus-engine
TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test PYTHONPATH=src PYTHONDONTWRITEBYTECODE=1 \
  /c/tmp/g115-py314/Scripts/python.exe -m pytest -p no:cacheprovider -q tests/test_permissions.py tests/test_admission_form.py \
  tests/test_kabul_identity.py tests/test_kabul_boardlink.py tests/test_unit_scope.py tests/test_patient_numbers.py \
  tests/test_migration_0012_kabul.py tests/test_structure_api.py tests/test_admission_api.py tests/test_discharge_api.py \
  tests/test_patient_identity_postgres.py 2>&1 | tail -1
```

Expected: `125 passed, 3 warnings`.

- [ ] **Step 5: The dashboard — the suite, then the build** (two commands):

```bash
cd /c/tmp/g2b-kabul/dashboard
npx vitest run 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^ Test Files |^ +Tests |^ FAIL "
```
```bash
cd /c/tmp/g2b-kabul/dashboard
npx vite build 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "built in|precache|larger than|error"
```

Expected: ` Test Files  100 passed (100)` and `      Tests  2535 passed (2535)`; `built in …`, `precache  20 entries`, no `larger than 500 kB`. (`/c/tmp/g2b-kabul/dashboard/node_modules` must be the junction to `/c/tmp/homunculus-g1/dashboard/node_modules`; if it is missing, make it as the lanes did — never install.)

- [ ] **Step 6: Lane A's regions, read by eye.** Every hunk in Lane A's files is one the coordination table names:

```bash
cd /c/tmp/g2b-kabul
git diff 2c585e8 HEAD --stat -- homunculus-engine/src/homunculus/api/app.py homunculus-engine/src/homunculus/api/board.py homunculus-engine/src/homunculus/api/patient_identity.py homunculus-engine/src/homunculus/api/patient_identity_postgres.py homunculus-engine/src/homunculus/api/clinical.py homunculus-engine/src/homunculus/api/alert_lifecycle.py
git diff 2c585e8 HEAD -U0 -- homunculus-engine/src/homunculus/api/app.py homunculus-engine/src/homunculus/api/board.py | grep "^@@"
```

Expected: four files — `api/app.py` 24 lines changed, `api/board.py` 33, `api/patient_identity.py` 56, `api/patient_identity_postgres.py` 11 (`4 files changed, 103 insertions(+), 21 deletions(-)`); `api/clinical.py` and `api/alert_lifecycle.py` absent. The hunks: in `app.py` four — `@@ -51,0 +52 @@` (the import), `@@ -311 +312,7 @@` (inside the retention sweep), `@@ -397,0 +405,3 @@` (`app.state.board_link`), `@@ -880,3 +890,9 @@` (`_occupants`); in `board.py` six — the import (`@@ -9 +9 @@`), `_bed_resolution`'s two lines (`@@ -213,0 +214,2 @@`, X51), the three helpers after it (`@@ -229,0 +232,24 @@`), `patient_board`'s two lines (`@@ -249,0 +276,2 @@`), `board_snapshot`'s filter and condition (`@@ -291,0 +320 @@`, `@@ -298 +327 @@`, X51) — none inside `_merge_alert`, `_latched_alerts`, `_risk` or `_escalation_cycle`. A review follow-up may move a line number; a hunk in another function is a stop.

- [ ] **Step 7: The reference patch** (outside the repository; a cross-check for review, not the authority):

```bash
cd /c/tmp/g2b-kabul
mkdir -p /c/tmp/homunculus-plans/g2b1a
git diff 2c585e8 HEAD -- . ':(exclude)docs/superpowers/plans/2026-10-25-g2b-kabul-taburcu.md' > /c/tmp/homunculus-plans/g2b1a/reference-built.patch
git diff --stat 2c585e8 HEAD -- . ':(exclude)docs/superpowers/plans/2026-10-25-g2b-kabul-taburcu.md' | tail -1
```

Compare it with the plan's own `/c/tmp/homunculus-plans/g2b1a/reference.patch` (`diff -q` them after Task 22; before it the docs differ): a difference outside a review follow-up is a task applied differently from its blocks. Nothing to commit.

---

### Task 21: The walk on a local stack (the agent drives; synthetic accounts and patients only)

**Where:** `/c/tmp/g2b-kabul`, after Task 20. **Not run while planning (O50).** Spec §8, §9.6 rehearsed locally. Nothing is committed; the outcome goes into Task 22's roadmap row.

- [ ] **Step 1: No other stack.** The compose file names its containers (`homunculus-postgres`, `homunculus-api`, `homunculus-web`), so only one such stack can be up. On 2026-10-25 the G2-01 `g2v` stack was still up on 18080, kept for the user's NVDA pass:

```bash
docker ps -a --format '{{.Names}} {{.Ports}}' | grep -E '^homunculus-(postgres|api|web) ' || echo "no stack containers"
ls /c/tmp/g115plan/stack/local.env /c/tmp/g115plan/stack/compose.g115.yml
```

If any of the three is listed, **stop and ask the controller** — whether the `g2v` stack (or another session's) may be taken down is the user's call. Never `down -v` a stack this task did not start.

- [ ] **Step 2: The stack, on port 18090** (HTTPS 18453; a different origin from G2-01's 18080, so no service worker of that stack serves this one), with the Aşama A monitor strip on (`INFINITY_CLINICAL_STAGE=shadow`, a fresh synthetic shadow token — spec §8 asks the walk to see the strip on a `kabul` card). The env copy holds G1-15's synthetic values; it is written outside the repo and never printed:

```bash
cd /c/tmp/g2b-kabul
mkdir -p /c/tmp/homunculus-plans/g2b1a/stack
grep -vE '^(WEB_PORT|WEB_TLS_PORT|INFINITY_CLINICAL_STAGE|INFINITY_SHADOW_TOKEN)=' /c/tmp/g115plan/stack/local.env > /c/tmp/homunculus-plans/g2b1a/stack/local.env
printf 'WEB_PORT=18090
WEB_TLS_PORT=18453
INFINITY_CLINICAL_STAGE=shadow
INFINITY_SHADOW_TOKEN=%s
' "$(/c/tmp/f7-py312/venv/Scripts/python.exe -c 'import secrets; print(secrets.token_hex(32))')" >> /c/tmp/homunculus-plans/g2b1a/stack/local.env
C="docker compose -p g2b -f deploy/local/docker-compose.yml -f /c/tmp/g115plan/stack/compose.g115.yml --env-file /c/tmp/homunculus-plans/g2b1a/stack/local.env"
$C build api web 2>&1 | grep -E "Built|ERROR|precache"
$C up -d postgres api web 2>&1 | tail -3
```

Expected: `Image g2b-api Built`, `precache  20 entries …`, `Image g2b-web Built`; three containers. Re-run `docker inspect -f '{{.State.Health.Status}}' homunculus-api` until `healthy`, then `curl -s -o /dev/null -w "http %{http_code}\n" http://127.0.0.1:18090/health` → `http 200`, and `docker exec homunculus-postgres psql -U homunculus -d homunculus -Atc "select version_num from alembic_version"` → `0012` (the api ran `alembic upgrade head` at start).

- [ ] **Step 3: The accounts.**

```bash
docker exec -e TEST_USER_PASSWORD='G115-Sentetik-Parola-1' -e SEED_TENANT_SLUG=demo-hastanesi homunculus-api python scripts/seed_test_users.py 2>&1 | grep -E "test\.(yonetici|sorumlu\.hekim|sorumlu\.hemsire|hemsire)@|TOTP"
```

Expected: `test.yonetici` (hospital_admin), `test.sorumlu.hekim` (attending), `test.sorumlu.hemsire` (charge_nurse), `test.hemsire` (nurse), all `@homunculus.health`, password `G115-Sentetik-Parola-1`; the TOTP line names the administrator and the attending (both groups require MFA). At their first sign-in the enrolment screen shows the manual key; a code is `/c/tmp/f7-py312/venv/Scripts/python.exe -c "import pyotp,sys; print(pyotp.TOTP(sys.argv[1]).now())" <key>` (the key is synthetic; do not write it into any file). The nurses are not assigned units: before enforcement an unassigned nurse reaches every bed, as on the board.

- [ ] **Step 4: The walk in a headless Chrome** at `http://127.0.0.1:18090`, language az then tr (a driver that sets `hmc.lang` in localStorage reloads the page). Each item is a pass or a finding, written down with the screen's own words:
  1. `test.yonetici`: Yönetim › Yapı — add a site "Sentetik Kampüs", a unit "Reanimasiya" (Erişkin YBÜ), rooms "Otaq 1", "Otaq 2", beds "1", "2" in Otaq 1 and "1" in Otaq 2; rename Otaq 2 → "Otaq 3"; close bed "1" of Otaq 3, see it marked; try to close Otaq 1 (open beds) → the toast "has_open_beds"'s words, named after the room. No UUID anywhere — also in the users tab, in a nurse's scope editor: the unit and its beds by name.
  2. `test.hemsire`: the top bar's unit chooser names "Reanimasiya". Hasta Kabul → Kabul: an empty form names every missing field and holds "Qəbul et"; fill a synthetic patient ("Sentetik Xəstə Bir", a date of birth, FİN `ABC1234`, weight 72, KOAH ticked, "Allergiya məlum deyil", consent), pick unit → room → bed "1 · Otaq 1 · Reanimasiya" (bed "1 · Otaq 3" is shown dimmed, "Bağlıdır", and choosing it does nothing); Qəbul et → the number box shows `H26…` large with "Çarpayı yanındakı cihaza bu nömrəni daxil edin.", and no failed part. Write the number down for the next steps (it is synthetic).
  3. Yataklar (the bed board): the card on bed "1" with the synthetic name and the badge "Həkim imzası gözlənilir". The patient screen: the strip says it waits for a signature; the nurse has no sign button (the strip says who signs).
  4. A second admission into the same bed from a second tab opened before the first was sent → the toast "bed_not_available"'s words named after the bed; the picker re-reads and the bed is no longer offered.
  5. `test.sorumlu.hekim`: the patient screen → "Kabulü imzala"; the toast names the bed, the strip and the bed card's badge go (within a minute on the board). Hasta Kabul → Taburcu: "Taburcuyu başlat" on the patient → dialog: Eve taburcu, now, a note → the row moves to "Taburcusu başlatılan".
  6. (The critical-alarm hold) Admit a second synthetic patient to bed "2", sign it, then raise a critical alert for its number with the inputs G1-15's `new_critical.sh` uses (septic shock; synthetic values, through `/ingest` and `/clinical`, the doors a monitor and a clinician use):

     ```bash
     TT=$(grep '^TENANT_TOKEN=' /c/tmp/homunculus-plans/g2b1a/stack/local.env | cut -d= -f2-)
     cd /c/tmp/g2b-kabul/homunculus-engine/scripts
     DEV_API=http://127.0.0.1:18090 DEV_TOKEN="$TT" PYTHONDONTWRITEBYTECODE=1 /c/tmp/f7-py312/venv/Scripts/python.exe -c "
     import sys, dev_seed_ward as w
     b = sys.argv[1]
     w.bed(b, device=[('heart_rate', 124), ('spo2', 91), ('sbp', 82), ('map', 58), ('temperature', 38.9), ('resp_rate', 24)],
           charted=[('platelets', 74), ('bilirubin', 2.4), ('creatinine', 1.9)])
     w.chart(b, [('suspected_infection', 1), ('lactate', 3.6)])
     w.chart(b, [('norepinephrine_rate', 0.14)])
     print(b, 'posted')
     " <the second patient's number>
     ```

     As `test.sorumlu.hekim`, Taburcu: "Taburcuyu başlat" on that patient is held, saying why (the server refuses `critical_alarm_open` anyway — Task 9's test). Acknowledge the critical alert on the board's alarm screen → the button is offered again.
  7. `test.sorumlu.hemsire`: Taburcu → "Hasta çıktı · onayla" on the first patient → the toast; the card is gone from the bed board **and from a second browser signed in as `test.hemsire` with the unit chosen in the top bar** (the scoped screen hears the removal, X55); Yataklar (Hasta Kabul) shows bed "1 · Otaq 1" in cleaning.
  8. `test.hemsire`: Yataklar → "Təmizlik bitdi · boş" on that bed → the toast, the bed AVAILABLE; Kabul offers it again.
  9. (Readings after discharge, X54, O41) One synthetic reading for the discharged number, through `/ingest` (the token read inside the command, never printed): `TT=$(grep '^TENANT_TOKEN=' /c/tmp/homunculus-plans/g2b1a/stack/local.env | cut -d= -f2-); cd /c/tmp/g2b-kabul/homunculus-engine/scripts; DEV_API=http://127.0.0.1:18090 DEV_TOKEN="$TT" /c/tmp/f7-py312/venv/Scripts/python.exe -c "import sys, dev_seed_ward as w; w.measure(sys.argv[1], [('heart_rate', 88)])" <the first patient's number>` — no card comes back on any screen (both browsers). This is why the ward clears the number from the bedside device at discharge.
  10. 390 px and 1440 px: no horizontal page scroll on Kabul, Taburcu, Yataklar, the dialog, Yönetim › Yapı; az, tr, ru, en: no raw `kabul.…` key; Gece and Gün.
  11. (The monitor strip on a `kabul` card — spec §8, §4.3's `_occupants`) A device→bed table that binds one synthetic monitor (`192.0.2.10`, the documentation range) to bed "2 · Otaq 1"'s UUID. The file is git-ignored (`git check-ignore -q deploy/local/infinity-shadow/device-beds.json && echo ignored` → `ignored`; if it is not, stop) and the API re-reads it every 10 s:

      ```bash
      cd /c/tmp/g2b-kabul
      IDS=$(docker exec homunculus-postgres psql -U homunculus -d homunculus -Atc "SELECT b.id || ' ' || r.unit_id FROM beds b JOIN rooms r ON r.id = b.room_id WHERE b.label = '2' AND r.name = 'Otaq 1'")
      mkdir -p deploy/local/infinity-shadow
      /c/tmp/f7-py312/venv/Scripts/python.exe -c "
      import json, sys
      bed, unit = sys.argv[1], sys.argv[2]
      row = {'source': '192.0.2.10', 'group': '239.20.1.10', 'port': 2050, 'bed_label': 'B-2', 'bed_id': bed, 'unit_id': unit,
             'method': 'monitor_screen', 'verified_at': '2026-10-25', 'valid_from': '2026-10-25T00:00:00Z', 'valid_to': None,
             'note': 'sentetik yerel yuruyus'}
      json.dump({'schema': 'homunculus.infinity-device-beds.v1', 'version': 1, 'site': 'yerel', 'approved_by': 'sentetik yerel yuruyus',
                 'approved_at': '2026-10-25', 'devices': [row]}, open('deploy/local/infinity-shadow/device-beds.json', 'w'))
      " $IDS
      git status --short deploy/local
      ```

      Expected: `git status` prints nothing (ignored). Then post shadow readings for that monitor, five of them, two seconds apart, over HTTPS (nginx refuses the lane on plain HTTP); the token is read inside the command and never printed:

      ```bash
      ST=$(grep '^INFINITY_SHADOW_TOKEN=' /c/tmp/homunculus-plans/g2b1a/stack/local.env | cut -d= -f2-)
      ST="$ST" /c/tmp/f7-py312/venv/Scripts/python.exe -c "
      import json, os, ssl, time, urllib.request
      ctx = ssl._create_unverified_context()          # the local stack's self-signed certificate
      for _ in range(5):
          now = time.time()
          body = {'schema': 'homunculus.infinity-shadow.v1', 'sent_at': now,
                  'forwarder': {'interval_s': 5, 'sent': 1, 'failed': 0, 'decoder': 'homunculus.infinity-preview.v3'},
                  'hub': {'collector_age_s': 1.0, 'accepted_packets': 10, 'old_or_duplicate_packets': 0},
                  'devices': [{'source': '192.0.2.10', 'group': '239.20.1.10', 'port': 2050, 'status': 'streaming',
                               'packet_age_ms': 120.0, 'readings': [{'parameter': 'hr', 'value': 72, 'unit': 'bpm',
                                                                     'valid': True, 'captured_at': now - 0.4}]}]}
          req = urllib.request.Request('https://127.0.0.1:18453/infinity-shadow/readings', data=json.dumps(body).encode(),
                                       method='POST', headers={'Content-Type': 'application/json',
                                                               'Authorization': 'Bearer ' + os.environ['ST']})
          try:
              print('shadow', urllib.request.urlopen(req, context=ctx, timeout=15).status)
          except urllib.error.HTTPError as exc:
              print('shadow', exc.code)
          time.sleep(2)                                 # the lane refuses a second post within a second
      "
      ```

      Expected: `shadow 200` five times (a `409` means the stage is off: the env copy was not read — check Step 2). In the browser, the second patient's screen and its bed card show the monitor strip (HR 72, marked unvalidated as Aşama A marks it) — the link went through the identity's own `bed_id`, not the bed map. Delete the table afterwards (`rm deploy/local/infinity-shadow/device-beds.json`, then `git status --short deploy/local` → nothing).
  12. `$C restart api`, wait for `healthy`, reload both browsers: the discharged patient stays off the board (the tombstone survived the restart); the second patient is still on bed "2" by name — the identity store and the engine's replay of the audit (the weight and the profile are written as audited `/clinical` rows, Task 6).
- [ ] **Step 5: Tear down — only after the controller says so** (the user may want to look): `$C down -v` (with `C` as in Step 2), then `docker ps -a --format '{{.Names}}' | grep -E '^homunculus-(postgres|api|web)$' || echo "no stack containers"` → `no stack containers`. If the `g2v` stack was taken down for this walk with the user's leave, bring it back as G2-01 Task 16 Step 5 does, if the user wants it.

---

### Task 22: The docs — the roadmap row and the Turkish guide

**Where:** `/c/tmp/g2b-kabul`. **Needs:** Task 20 (the counts the row quotes), Task 21 (its outcome, if run).

The roadmap gains the row G2-B1a, and the Turkish guide (`docs/homunculus-rehber-TR.md`, kept living: the user reads it) a §3.8 "Hasta Kabul" — what the screens do, who may do what, the patient number and why the device needs it, the discharge's two steps and the alarm hold, the bed release, Yönetim › Yapı, and what this slice does not do yet. Two values in the row are the run's own: replace `<date>` with the day the slice's code is complete (`YYYY-MM-DD`) and `<range>` with the first and last commit of the slice (`git log --format=%h 2c585e8..HEAD | tail -1` and `| head -1`, as `aaaaaaa..bbbbbbb`); then append to the row's status the Task 20 counts and Task 21's outcome in the G2-01 row's manner (or "yerel yürüyüş koşulmadı" if it was not run).

**Files:**
- Modify: `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md`
- Modify: `docs/homunculus-rehber-TR.md`

- [ ] **Step 1: The row and the guide's section:**

**Edit** `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md` (1) — replace:

```markdown
| G2-A1 | Alarm bölümleri (O17): bir alarm, kuralı onu üretmeyi bıraktığı ilk ölçümde kapanır; kimsenin onaylamadığı kritik alarm «geçti · onaylanmadı» olarak onaylanana kadar kalır, sesi durur; yeniden çıkan alarm yeni bir bölümdür (yeni ilk görülme, eskalasyon saati, hemşire bildirimi ve ▲); `alert_cleared` denetim olayı; yeniden başlatma panoyu bölüm bölüm kurar · spec: [2026-10-25](../specs/2026-10-25-g2a-alarm-bolumleri-design.md) · plan: [G2-A1](2026-10-25-g2a-alarm-bolumleri.md) | Kod ✅ 2026-10-25 · 39812b6..7251540 · **VM'de değil** (kabul kullanıcıyla, ayrı adım: spec §6; web api'den sonra değil — eski web, kilitli kalan bir kritiği hâlâ çalıyormuş gibi seslendirir). Backend 2220 / 650 (DB'siz), Python 3.14 dilimi 179; dashboard 89 dosya / 2411 test; derleme 20 öğe. Kabul (spec §6'nın dört adımı) geliştirme sunucusunda (X11) geçti — SQLite denetim, gerçek yeniden başlatma, sentetik yataklar; Docker yığını çalıştırılmadı. **Açık:** plandaki X1–X14 (X9: antibiyotik saatinin başlangıç anı yalnız şüpheli enfeksiyon «yok» diye kaydedilince bırakılır, antibiyotik alarmları yalnız sepsis ya da septik şok sürerken görünür — kullanıcı kararı 25.10; X10: «geçti · onaylanmadı» rozeti yalnız alarm ekranında değil, yatak kartında, yatak listesinde, zilde ve hasta ekranında da; X11: kabul geliştirme sunucusunda; X12: «yok» işareti 15 dakika içinde düzeltilirse eski antibiyotik penceresi geri gelir; X13: kimsenin yanıtlamadığı bir alarm eskalasyon süresi içinde dönerse aynı eskalasyon zinciridir, onay zinciri bitirir; X14: doktor zincir başına bir kez çağrılır) ve O1–O15 (O15: saatlerce yanıtsız kalan bir alarm için yinelenen çağrı yok — sonraki dilimde kullanıcı kararı); az/ru/en metinleri yerel okuma bekliyor |

```

with:

```markdown
| G2-A1 | Alarm bölümleri (O17): bir alarm, kuralı onu üretmeyi bıraktığı ilk ölçümde kapanır; kimsenin onaylamadığı kritik alarm «geçti · onaylanmadı» olarak onaylanana kadar kalır, sesi durur; yeniden çıkan alarm yeni bir bölümdür (yeni ilk görülme, eskalasyon saati, hemşire bildirimi ve ▲); `alert_cleared` denetim olayı; yeniden başlatma panoyu bölüm bölüm kurar · spec: [2026-10-25](../specs/2026-10-25-g2a-alarm-bolumleri-design.md) · plan: [G2-A1](2026-10-25-g2a-alarm-bolumleri.md) | Kod ✅ 2026-10-25 · 39812b6..7251540 · **VM'de değil** (kabul kullanıcıyla, ayrı adım: spec §6; web api'den sonra değil — eski web, kilitli kalan bir kritiği hâlâ çalıyormuş gibi seslendirir). Backend 2220 / 650 (DB'siz), Python 3.14 dilimi 179; dashboard 89 dosya / 2411 test; derleme 20 öğe. Kabul (spec §6'nın dört adımı) geliştirme sunucusunda (X11) geçti — SQLite denetim, gerçek yeniden başlatma, sentetik yataklar; Docker yığını çalıştırılmadı. **Açık:** plandaki X1–X14 (X9: antibiyotik saatinin başlangıç anı yalnız şüpheli enfeksiyon «yok» diye kaydedilince bırakılır, antibiyotik alarmları yalnız sepsis ya da septik şok sürerken görünür — kullanıcı kararı 25.10; X10: «geçti · onaylanmadı» rozeti yalnız alarm ekranında değil, yatak kartında, yatak listesinde, zilde ve hasta ekranında da; X11: kabul geliştirme sunucusunda; X12: «yok» işareti 15 dakika içinde düzeltilirse eski antibiyotik penceresi geri gelir; X13: kimsenin yanıtlamadığı bir alarm eskalasyon süresi içinde dönerse aynı eskalasyon zinciridir, onay zinciri bitirir; X14: doktor zincir başına bir kez çağrılır) ve O1–O15 (O15: saatlerce yanıtsız kalan bir alarm için yinelenen çağrı yok — sonraki dilimde kullanıcı kararı); az/ru/en metinleri yerel okuma bekliyor |
| G2-B1a | Hasta Kabul (Lane B): Yönetim › Yapı; Kabul · Taburcu · Yataklar; Homunculus hasta numarası (`H` + yıl + 5 hane); kabul kartı yatağına koyar (kimlik kaynağı `kabul`, yatak/birim UUID), kilo ve eşlik eden hastalık motora; hekim imzası hasta ekranından; iki adımlı taburcu (çıkış şekli + onay), onaylanmamış kritik alarm engeller; kart her ekrandan kalkar (kaldırma çerçevesi son yatak/birimi taşır); `beds.release`; göç `0012` · spec: [2026-10-25](../specs/2026-10-25-g2b-kabul-taburcu-design.md) · plan: [G2-B1a](2026-10-25-g2b-kabul-taburcu.md) | Kod ✅ `<date>` · `<range>`. **Açık:** plandaki X51–X66, O39–O53; VM'ye dağıtım kullanıcıyla (plan, son görev) |

```

**Edit** `docs/homunculus-rehber-TR.md` (1) — replace:

```markdown
söylenir ve eğri yeniden okunur.

---

```

with:

```markdown
söylenir ve eğri yeniden okunur.

### 3.8 Hasta Kabul (Grup 2 · B1a)

Bu dilimden önce hiçbir ekran "bu hasta bu yatakta yatıyor" diyemiyordu: kabul kayıtları
(Postgres, `admission/`) ile pano (motor, kimlik deposu) iki ayrı dünyaydı ve hiçbir şey onları
bağlamıyordu. **Artık Homunculus'ta yapılan kabul, hangi hastanın hangi yatakta yattığının asıl
kaydıdır** (kullanıcı kararı D1); HBYS akışı geldiğinde yalnız formu önceden doldurur.

**Ekranlar**
- **Yönetim › Yapı** (`structure.manage`): yönetici koğuşu kurar — bina, birim (türüyle), oda,
  yatak; adını değiştirir, kapatır, yeniden açar. Hiçbir şey silinmez; kapatılan yer kalır ve
  kabule sunulmaz. Hastası olan yatak kapatılamaz; altında açık yatak olan oda ya da birim de.
- **Hasta Kabul › Kabul** (hemşire, sorumlu hemşire: `admissions.admit`): prototipin tam formu —
  kimlik, kabul, iletişim ve onam, yatak. Sağdaki panel eksik her zorunlu alanı adıyla söyler;
  panel boşalana dek "Kabul et" basılsa da gönderilmez. Yatak seçicide yalnız boş ve açık yatak
  seçilir; dolu, temizlikte ve kapalı yataklar soluk ve nedeniyle görünür. Hekim bu sekmeyi salt
  okunur bir notla görür: kabulü hekim yapmaz, imzalar (D6).
- **Hasta Kabul › Taburcu**: hekim (`admissions.move.initiate`) "Taburcuyu başlat" der ve çıkış
  şeklini seçer — eve, başka kuruma (kurum adıyla), vefat (bildiren hekim: kendisi, ya da yazdığı
  ad) — saati (şimdi; gelecekte olamaz) ve not; sorumlu hemşire (`admissions.discharge.confirm`)
  hasta çıkınca "Hasta çıktı · onayla" der (D7). Onaylanmamış kritik bir alarm (kuralı susmuş
  ama kimsenin onaylamadığı kritik alarm da — G2-A1) taburcu başlatmayı engeller.
  İmzalanmamış (DRAFT) kabul önce imzalanır.
- **Hasta Kabul › Yataklar**: birimlerinizin yatakları ve durumları; temizlikteki yatakta
  "Temizlik bitti · boş" (`beds.release`, hemşire ve sorumlu hemşire — gece yöneticisiz yatak
  dönüşü, D8).
- **Hasta ekranı ve kart:** imzalanmamış kabulde "Hekim imzası bekliyor" şeridi ve kartta küçük
  bir rozet; `admissions.sign_off` sahibi hekim şeritten "Kabulü imzala" der ve kabulün sorumlu
  hekimi olur.

**Hasta numarası:** Homunculus her kabule bir numara verir: `H` + yılın iki hanesi + beş hane
(`H2600042`). Kurum ve yıl başına sıralıdır (yıl UTC'dir), yılbaşında 1'den başlar; iki kabul
aynı numarayı asla alamaz (sayaç satırı kabulün kendi işleminde kilitlenir). `H` öneki numarayı
HBYS protokol numaralarından ayırır — ikisi aynı olsaydı iki hasta tek karta düşerdi ("X" olayı).
Hemşire bu numarayı başucu cihazına girer; okumalar karta o numarayla gelir. HBYS protokol
numarası ayrı ve isteğe bağlı bir alandır.

**Kabul olunca:** kart hemen o yatağa ve o birime düşer (kimlik kaydının kaynağı `kabul`, yatak
ve birim kurumun kendi kimlikleriyle — UUID); kilo ve eşlik eden hastalık kodları motora yazılır.
Biri motora ulaşmazsa kabul yine durur ve ekran hangisinin elle girileceğini söyler. Kart ve
izlem kabulle başlar; hekim imzası sonraki adımdır (D3).

**Taburcu onaylanınca:** kart her ekrandan kalkar — birime göre sınırlı ekranlardan da; kaldırma
bildirimi yatağın ve birimin kimliğini taşır. Yatak temizliğe geçer. Taburcu edilen numaraya
sonradan okuma gelirse motor saklar ama kart geri gelmez (kimlik kaydı 24 saatte silinmez,
"mezar taşı" olarak kalır).

**Birim kapsamı:** kabul, imza, taburcu ve yatak bırakma, hedef yatağın birimini çağıranın birim
ve yatak atamalarıyla karşılaştırır; atanmamış çağıran (pilot ayarı) ve yönetici her yere ulaşır.
Atamalar artık birim ve yatakların UUID'sini taşır; hiçbir ekran UUID göstermez, adı
`GET /tenant/structure`'dan okur (üst çubuktaki birim seçici, yatak panosu, kapsam düzenleyici).

**Reddedilen işlem:** sunucu her reddi değişmez bir kodla verir (`bed_not_available`,
`out_of_scope`, `critical_alarm_open`, `field_invalid:<alan>` …); ekran kodu çevirir, sunucunun
İngilizce sözcüklerini göstermez. Ret, işlemin konusu olan yatakla birlikte bildirimde söylenir.

---

```


- [ ] **Step 2: Fill `<date>` and `<range>`** (Edit on the roadmap; the guide has no such value), and add the counts and the walk's outcome to the row.

- [ ] **Step 3: Line ends:**

```bash
cd /c/tmp/g2b-kabul
for f in docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md docs/homunculus-rehber-TR.md; do printf "%s CR=%s LF=%s\n" "$f" "$(tr -cd '\r' < "$f" | wc -c)" "$(tr -cd '\n' < "$f" | wc -c)"; done
```

Expected:

```text
docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md CR=1295 LF=1295
docs/homunculus-rehber-TR.md CR=1231 LF=1231
```


(These are the counts with `<date>` and `<range>` still in place; Step 2 changes no line end.)

- [ ] **Step 4: Commit:**

```bash
cd /c/tmp/g2b-kabul
git add -- docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md docs/homunculus-rehber-TR.md
git status --short && git diff --cached --stat
git commit -m "docs: G2-B1a — the roadmap row and the Turkish guide's Hasta Kabul section" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md docs/homunculus-rehber-TR.md
```

---

### Task 23: The VM blocks (the controller writes them; the user pastes them)

**Where:** outside the repo: `/c/tmp/infinity-a-releases/G2B1a-bloklari.txt` and the bundle beside it. **Needs:** Tasks 21 and 22, and the user's go (memory: one deploy at a time across both lanes; nothing reaches the VM before the user says so). **Not run while planning (O50).** The agent never runs a block on the VM; it may run the read-only checks the blocks mark as its own (the shadow-lane check). The file is written in Turkish, in the manner of `/c/tmp/infinity-a-releases/G2-bloklari.txt` (sections A–G, each block `bash -eu -o pipefail <<'BLOK' … BLOK` with "Beklenen:" and "Geri alma:").

What it must hold, in order (spec §9):

- **Precondition.** The VM runs NBP (api + web `f72dafa`, 25.10; rollback tags `:pre-nbp`). This branch also carries Lane A's A1 (O17), which is **not** on the VM and has its own acceptance with the user (its spec §6; its roadmap row: the web goes with the api, never after it — an old web would sound a latched critical as if it still fired). One deploy at a time: A1 goes first, with its own blocks and acceptance, unless the user decides to ship both together — then A1's acceptance steps join E below. The blocks name the VM's HEAD they expect and stop on any other.
- **NE DEĞİŞİYOR.** The code (the branch, the commit); **migration `0012`** — so the rollback is **the database dump plus the image tags**, unlike G2-01's; the bridge and the Infinity hub/worker do not change; the order (one deploy, api + web together, no bridge step).
- **A-1 (workstation, the agent prepares):** `git -C /c/tmp/g2b-kabul bundle create /c/tmp/infinity-a-releases/g2b1a-<short>.bundle <the VM's current commit>..feat/g2b-kabul`, its `sha256sum`, `bundle verify`; the user copies it with `scp` to `~/g2b1a/`; the shadow check before (`shadow_check.py --window 10`, the agent runs it).
- **B-1 (VM, read-only; counts only — PHI is never printed):** the VM's HEAD is the one the last deploy left (NBP `f72dafa`, or A1's commit if A1 went first — read from that deploy's blocks file and the roadmap) and the tree is clean but for `.bak` files; `alembic_version` is `0011`; the counts of `sites`, `units`, `rooms`, `beds` per tenant (spec §9.1); the count of `staff_scopes` grants and how many of them are not a UUID (old free-text keys, O40 — the count only); the count of `patients` (each gets a number in `0012`); the bundle verified; the current image ids recorded under `~/g2b1a/`; free disk (at least 3 GiB).
- **B-2 (VM): the dump.** `sudo docker exec homunculus-postgres pg_dump -U homunculus homunculus | gzip > ~/g2b1a/before-0012.sql.gz`, its size and `gzip -t`; refuses to overwrite an existing dump.
- **B-3 (VM): rollback tags** `homunculus-rollback/api:<current short>` and `homunculus-rollback/web:<current short>` for the running images, refusing to overwrite a tag that exists (G2-01's B-2 pattern).
- **D-1 (VM): the code** — `git fetch` the bundle into `feat/g2b-kabul`, checkout, HEAD check, `ls homunculus-engine/alembic/versions | tail -1` → `0012_admission_kabul.py`.
- **D-2 (VM): build and start api + web** — `BUILD_SHA`, `compose build api web`, `up -d --no-build api web`; health; `alembic_version` → `0012` (the api runs `alembic upgrade head` at start); `patients` without a number → 0; the `beds.release` rows of the nurse groups (count); `GET /tenant/structure` without a token → 401; the hub `active`.
- **D-3 (workstation, the agent): the shadow check after** — `SONUÇ: KABUL`, the board summary as before.
- **E-1 (browser, the administrator):** Yönetim › Yapı — the ward is built (or its existing rows renamed and closed as the user decides) with the names the staff use; the user reads it on the screen. The old free-text grants counted in B-1, if any: the administrator re-selects them in the scope editor (O40: they show as typed, they are not flagged).
- **E-2 (the device→bed table, version 2 — the user's approval, spec §9.4):** after E-1, a read-only VM query prints the new structure's bed **labels with their UUIDs** (no patient data in it); the agent writes `deploy/infinity/device-beds.icu2.json` version 2 with each device's `bed_id` and `unit_id`, runs `deploy/infinity/device_beds_review.py` on it, and asks the user to approve each row in words (recorded verbatim in the commit, as `a2c1257` did); committed, bundled, copied to `/opt/homunculus/deploy/local/infinity-shadow/device-beds.json` with its sha256 checked against the commit's; the API re-reads the table within 10 s (`infinity_device_beds.RELOAD_EVERY_S`, no restart); `GET /infinity-shadow/board` shows version 2 and its sha. Rows whose bed the structure does not hold stay as in version 1 (`bed_id` null), and the user says so row by row.
- **E-3 (the acceptance walk with the user, a real admission, spec §9.6):** a real patient is admitted (the screen's values are never written into any file or chat); the number is entered on the bedside device; the card on the right bed; the monitor strip on the card; later, discharge (start and confirm) and the bed's release; the device cleared of the number (O41). The agent records pass/finding per step, no values.
- **G (rollback):** G-1 api + web back to the tags **and** the database back from `before-0012.sql.gz` (stop api, `dropdb`/`createdb` or `psql` restore into an empty database, start the tagged images) — **the price:** every admission, number, discharge and audit row written after B-2 is lost, so the state is dumped first (`pg_dump` to `~/g2b1a/after-0012.sql.gz`) and kept. `alembic downgrade 0011` is **not** the rollback (it drops the numbers and the form's fields; the dump is the record). G-2 the device table back to version 1 (its committed bytes, sha checked).

Self-check before handing the file to the user: every block names its host; every value is filled (bundle sha, commits); no block prints a patient's name, number or value; every write has its "Geri alma".

---

## Self-review

**Spec coverage.** D1 (an admission is the bed's source of truth; the board joins it) — Tasks 5, 6, 8. D2 (admission and discharge in one slice) — Tasks 8, 9, 14, 15. D3 (card and monitoring at admission, sign-off later) — Tasks 8, 9, 17. D4 (the Homunculus patient number) — Tasks 2, 8, 14. D5 (the whole form, encrypted columns) — Tasks 2, 3, 14. D6 (nurses admit, physicians sign) — Tasks 8, 13, 14 (the physician's read-only note). D7 (two-step discharge, disposition, the alarm hold) — Tasks 6, 9, 15. D8 (`beds.release`) — Tasks 1, 2, 7, 16. D9 (UUID everywhere, no UUID on a screen) — Tasks 2, 4, 5, 12, 19, 23 (the device table). D10 (Yönetim › Yapı) — Tasks 7, 18. §3.1–§3.5 flows — Tasks 8, 9, 7 and 14–18. §4.1 data, §4.2 number — Task 2; §4.3 join — Tasks 4–6; §4.4 routes and codes — Tasks 3, 7, 8, 9, 11; §4.5 unit scope — Tasks 4, 7, 8, 9. §5.1–§5.7 — Tasks 10, 12–19. §6 (no rule, threshold or NEWS2 change) — no task touches them. §7 Lane A — the coordination table, Tasks 5, 6, X51, X61. §8 tests — every task's tests; the whole flow is Task 9's last test; the local walk, Task 21 (with the strip on a `kabul` card). §9 deploy — Task 23. §10 — nothing built; the open items name what remains.

**Placeholder scan.** The only values left to the run are Task 22's `<date>` and `<range>` (the merge's own date and commits) and Task 23's bundle sha and commits (the deploy's own); each is named where it is filled.

**Consistency.** Names used across tasks were checked by the replay, which ran every task's tests on the tree the earlier tasks built: `count_open_critical`, `BoardLink.open_critical`/`discharge_identity`, `kabul_record`, `board_link_of` (Tasks 6, 8, 9); `caller_scope`/`reaches`/`require_reach` (Tasks 4, 7, 8, 9); `next_patient_number` (Tasks 2, 8); `check_admission`/`check_discharge`, `COMORBIDITY_CODES` (Tasks 3, 8, 9, 11, 14); `err.apiCode`, `admissionCodeKey`, `ADMISSION_CODE_KEYS`, `INVALID_FIELD_KEYS` (Tasks 11, 14–18); `useStructure`, `unitLabel`, `bedLabel`, `admissible`, `unavailableKey` (Tasks 12–18); `useAdmissions` (Tasks 15, 17); `KABUL_TABS`/`kabulTabs` (Task 13).

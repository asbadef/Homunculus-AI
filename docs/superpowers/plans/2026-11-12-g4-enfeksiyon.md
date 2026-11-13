# G4-05 «Enfeksiyon kontrol» Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Task 1 runs first, alone** (the permission key both halves read). Then two implementers run the **engine lane** (Tasks 2–7) and the **dashboard lane** (Tasks 8–16) **in parallel, in the same worktree**. Task 17 (docs) and Task 18 (gates) run after both lanes report.

**Goal:** A page `/enfeksiyon` «Enfeksiyon kontrol» for `infection.view` that shows, per unit, the patients in isolation and where, the patients with suspected infection or a Sepsis-3 alarm with Eczane's antibiotic clock, and the isolation beds — every number the server's or «—» with its reason — and, on the patient screen, an «İzolasyon» box in which a `clinical.chart` holder records the patient's isolation precautions as four charted flags; an existing room can be marked as an isolation room on Yönetim › Yapı.

**Architecture:**
- **Engine:**
  - the key `infection.view` (the 31st), held by the default `attending`, `unit_physician`, `physician`, `charge_nurse` and `nurse` groups (migration `0023`, data only) and by the system group by rule;
  - four new chart codes `isolation_contact|droplet|airborne|protective` — flags (`CHARTABLE` "bool", `_BOOLEAN`), in one order (`ISOLATION_CODES`), under the bedside time bound, not withdrawable, never in the measurement record, refused at `/ingest` from a device (400);
  - the board card's `isolation` block (`api/board.py` `_isolation`): four three-valued flags, `types`, the server's `state` word, `charted_at` — no person (§5 S2); `null` on an identity-only card;
  - `GET /infection` (`api/infection.py`, pure, through `_board_for` as `/pharmacy`): the isolated and the suspected rows (Eczane's antibiotic object, the three Sepsis-3 kinds firing and latched, `sort_group`), `bed_occupants`, the counts whole and per unit; not audited;
  - `RoomPatch.is_isolation`: an existing room marked or unmarked, audited `structure.isolation` (§5 O1).
- **Dashboard:**
  - `useInfection` (GET /infection every 30 s, Eczane's rules) with the structure tree read in the same tick; the answer's clock skew moved to `screens/common/skewAtReceipt.js`;
  - a pure `screens/enfeksiyon/enfeksiyon.js` — the isolation beds from the tree and the answer's occupants, the unit selection, the order by name, Decision 18 per cell — worded by `EnfeksiyonScreen.jsx`;
  - the patient screen's `IsolationBox.jsx` under the Sepsis box; Yapı's room button; `structure.isolation` labelled on «Denetim bütünlüğü»; the device door's refusal in four languages; the route after `isyuku` (icon `thermo`).

**Tech Stack:**
- Engine: Python 3.14, FastAPI, SQLAlchemy 2 (async), Alembic, pytest.
- Dashboard: React 18, Vitest 2, Testing Library, Tailwind.
- Guide: Turkish Markdown.

**Spec (the contract):** `docs/superpowers/specs/2026-11-12-g4-enfeksiyon-design.md` — committed at `9710129e`, amended at `ebadfb01` (**§5 Değişiklikler: S1, S2, O1, A1–A4, A6 and M1–M9 supersede D7–D22 where they differ**; D11 is withdrawn). The branch `feat/g4-enfeksiyon` was cut from main `88f6544c` (G3-05 and G4-04 in); this plan is written for head `ebadfb01`. Read the spec whole — §5 last, and the answer after §5 at its end — before your first task.

---

## Plan notes: where the spec meets the code

Each note records a choice this plan makes where the spec and the tree disagree, or where the spec leaves a detail open. The notes bind the implementers. A reviewer who disagrees raises it; the implementer does not improvise.

**N1: The four codes at the two doors (spec D3, D7, §5 M8).**
- `canonical.py` gains `ISOLATION_CONTACT … ISOLATION_PROTECTIVE` after `ANTIBIOTIC_ADMINISTERED`. `api/clinical.py` gains `ISOLATION_CODES` (the one order: contact, droplet, airborne, protective), the four in `CHARTABLE` as `"bool"` and in `_BOOLEAN` (0 / 1 / `true` / `false`; 0.5 is the door's own 400 «yalnız 0 veya 1 olabilir»), and `_check_bedside`'s time bound (24 h back, 2 min ahead) for a request that charts one with a time.
- They stay out of `RETRACTABLE_CODES`, so out of `api/readings.py` `MANUAL_CODES` — never filed in the measurement record — and the withdrawal answers 409 `RETRACT_NOT_BEDSIDE`. No rule reads them.
- `POST /ingest` refuses them right after `parse_fhir_observation`, before `_withdrawn_again`, `_resent`, the discharged filing and the unknown-number filing: nothing reaches the engine, the trail, the record or the unmatched list. The 400's `detail` is an inline literal, so the dashboard's `apiErrors.test.js` sweep reads it (N12).
- **Not covered by M8, left as is:** the chart door accepts the bridge's device token, as every board route does (the existing tests chart through it), so a device token could still chart a flag through `POST /clinical`. The spec closes `/ingest` only; the owner is told (the report), nothing is changed here.

**N2: The card's `isolation` block (spec D8 as §5 S2 amends it).** `api/board.py` `_isolation(state)`: each flag named by its slug after `isolation_`, `None` when never charted, else `latest().value >= 1`; `types` the true ones in `ISOLATION_CODES` order; `state` `isolated` / `not_isolated` / `unrecorded`; `charted_at` the newest of the four latest observations' timestamps, as stored (the door stamps UTC). `identity_only_board` carries `"isolation": None` (so does a tombstone, which no screen shows). No `charted_by` and no `AckStore` field (S2). The replay needs nothing: `rehydrate.observation_of` builds any `SignalCode` slug, and an older api skips the four unknown slugs (Task 3's last test pins the skip).

**N3: `GET /infection` (spec D10 as §5 S1, S2, A3, M3, M4 amend it).** The builder `api/infection.py` `ward_infection(cards, now=)`; the route in `api/app.py` after `/pharmacy`, `INFECTION_VIEW` beside `PHARMACY_VIEW`; not audited; the device token passes. Where the spec is silent:
- the server sends `isolated`, `suspected` and `bed_occupants` by patient key and `units` by unit id: M4 moved the order to the page, and a fixed order keeps two answers comparable;
- `suspected` = `suspected_infection` true **or** any listed alarm of the three kinds, firing or latched (M3); `counts.suspected` counts the true marks only; `suspected_unrecorded` counts `suspected_infection is None`, which covers a card with no `sepsis` block (A3);
- `sepsis_alarms` reads the card's `alerts`; the board lists a kind once (a latched one only while it does not fire), so a row has at most one item per kind; `snooze_until` is the card alert's `snooze.until`;
- `sort_group`: 0 an antibiotic state in Eczane's `CLOCK_OPEN`, 1 a firing alarm of the three kinds, 2 the rest — on every row;
- the spec's first answer (`beds`, `isolation_beds`, `unit_name`, `in_isolation_room`) is not built (S1). `api/pharmacy.py` is not touched (M4).

**N4: The isolation beds, on the page (§5 S1, A4).**
- `data/structure.js` `indexStructure` gains `isIsolation` on its room and bed entries (additive).
- A tile is every bed whose bed, room and unit are open in a room with `is_isolation`, in the tree's own order — the server sorts units, rooms and beds by name inside a site, which is D10's «unit name, room name, bed label».
- `tileOf` (D10's table and A4 a): a bed state with a patient (occupancy.js `WITH_PATIENT`) is `isolated` if one occupant is, `not_isolated` if every one is not, `unknown` if an occupant carries a word this build does not know, else `unrecorded`; with no occupant on this list, `occupant_unseen`. A bed that has an occupant while its tree state has no patient is `conflict` — any such state, not only AVAILABLE: a BLOCKED or HOUSEKEEPING bed with a card on it is no more «kullanım dışı» or «temizlikte» than AVAILABLE is «boş». The conflict tile names the tree's state by `kabul.state.*`, lowercased in the interface language («yapıda boş · panoda hasta var»).
- BLOCKED reads «kullanım dışı» without a reason (S1). `bedTally`: total, `free` tiles, tiles whose state has a patient; a conflict is in neither.
- Without an answer no tile is drawn; with a tree that does not count (N5) the section, the tally, the «boş izolasyon yatağı» card and every «Oda» cell say the tree's reason, and the rest of the page stands.

**N5: The tree's own source (§5 S1).** `ozet.js` `structureSource(tree, mayTree)`: only phase `known` counts; `stale` (a reload failed, the last tree stands) and `failed` read «yapı okunamadı: {neden}» (`readErrorText` of the tree's error); a 403 or no structure key «yapı okunamıyor»; loading «okunuyor…». `useInfection` calls the provider's `reload` with every read — at mount too, as `useSummaryReads` does — for a session holding one of `STRUCTURE_PERMS` only; a failing tree read never holds the list back.

**N6: Unit names, the filter, the order (§5 S1, M4).**
- Names through `useUnitNames` over the filter's ids: the tree's open units, then the answer's `units` and its rows' units, each once by `normId`. D15's «— birim adı okunamadı» is therefore not built: an id the tree lacks is named as on every other screen (`unitNamer`); «— birimi belli değil» is for a row with neither its own unit nor a bed the tree holds.
- A bed-only row shows its bed's unit in «Birim» and is ordered by it (`unitOf`), but stays under «Tüm birimler» only: `selectionOf` filters by the row's own `unit_id`, where the server counts it (M4).
- `sortRows`: for the suspected list the server's `sort_group` first (group 0 by `remaining_sec`, least first); then the unit's name in the interface language (`localeCompare(lang, {numeric: true, sensitivity: "base"})`), a row on no unit last; the bed label as the board orders it (`"en"`, the same options; else the key); the key.
- A chosen unit that drops out of the choices while an answer is held falls back to «Tüm birimler» with «Seçili birim artık kapsamınızda değil.»; the sentence stays until the reader picks again.

**N7: Decision 18, as built (spec D15, §5 A3, A4).**
- «{HH:MM} itibarıyla» is drawn only from a fresh answer; a held one is named in the crit alert («Enfeksiyon listesi güncel değil · son yanıt {saat}» and the read's reason) and under the cards («son yanıt {saat} itibarıyla»).
- `countCell`: a fresh number, 0 included; not fresh, a number above 0 stays, a 0 is «— liste güncel değil»; the cards' second lines (A3) follow the same rule.
- `freeBedsCell`: «{free} / {total}»; no room: «— izolasyon odası tanımlı değil»; not fresh: «— liste güncel değil» (A4 c); a tree that does not count: its reason. The tally line likewise.
- `tileWords`: from an answer that is not fresh the three quiet tiles are «— liste güncel değil», and an isolated tile reads «son yanıtta · izolasyonlu hasta» (A4 c); the tree's own states keep their words.
- The alarm cell: «son yanıtta: {tür}» per alarm, «— liste güncel değil» for none; the antibiotic cell is Eczane's, its stale twins included. The empty sentences only from a fresh answer; «Kapsamınızda izolasyon odası tanımlı değil.» only from a fresh answer and a tree that counts.
- A refused read (401 / 403) drops the answer: no card, no table, no tile and no name stays. The honesty note, the isolation-record note and `eczane.note` stay in every state; `eczane.source` is drawn with an answer, as on Eczane.

**N8: The words that differ from the spec's.**
- (a) M3's «ertelendi · {saat}'e kadar» is «ertelendi · bitiş {time}»: the suffix after a time depends on how the time is read aloud (10:30'a, 11:00'e), and the namespace glues no suffix to a time (`enfeksiyon.strings.test.js`) — Eczane's «bitiş {time}».
- (b) The box's buttons say what they save: «İzolasyonu kaydet» (D16's «Kaydet») and «Seçimden vazgeç» (A1's «Vazgeç»), and «Yine de kaydet». The patient screen has other «Kaydet» and «Vazgeç» buttons (Meds, Sıvı, the SOFA form, dialogs); a reader with a screen reader, and the tests, find a button by its name.
- (c) O1's two notices are fragments after the subject — «Otaq 1 · Reanimasiya · izolasyon odası olarak işaretlendi» — because the tab's `write` puts every notice through `admin.doneFor` («{subject} · {text}»), as «adı değişti» and «kapatıldı» do; the spec's «{subject} …» sentence would print the subject twice.
- (d) The box's Azerbaijani «no right» sentence is worded apart from the Sepsis box's: an existing patient-screen test pins that one by a regex.

**N9: The «İzolasyon» box (spec D16, §5 S2, A1, M2, M8).** `screens/patient/IsolationBox.jsx`, props `{patientId, isolation, bed, canChart, known, nowMs, onChart, onRefresh}`; the screen passes `(entries) => board.store.chart(id, entries)` and `() => board.store.refresh()`, so the box's own tests need no board store. The draft (`null` while untouched), `seededAt` (the card's `charted_at` at the first touch), `held` (A1), one save at a time (`sending`), the answers (M2), and a move to another patient resetting all of it. While the board is not LIVE the boxes stay (they follow the card or the draft) and the save is replaced by «Pano güncel değil — kayıt için panonun yeniden bağlanmasını bekleyin.». The box sits under the Sepsis box in a column of its own in the grid's left cell (M8). The page's `patient.onlyWrite` names six things (M6), and the patient-screen test that pinned «five» pins «six».

**N10: An existing room marked as an isolation room (§5 O1).** Engine: `RoomPatch.is_isolation`; `_changes(…, was_isolation, is_isolation)` appends `structure.isolation` after a rename and a close or reopen; `patch_room` sets it under `_lock_unit`; a unit and a bed pass no flag; the router's docstring names the fifth type. Dashboard: `Node` gains an `action`; the room's button has its own busy key (`${room.id}~iso`), so it alone turns busy and the room's rename and close are held while it is out. An existing `StructureTab` test asked that «Otaq 1»'s line carry no «İzolyasiya» text; the line now carries its own button, so the test asks for the tag's whole text (Task 14 Step 1). `/denetim` names the type (EVENT_TYPES 61 → 62); `engineTypes.test.js` reads it through `_changes` (its anchor list gains it).

**N11: The answer's clock skew and the hook (spec D14 as §5 M9).** `skewAtReceipt` and `SKEW_NOISE_MS` move to `screens/common/skewAtReceipt.js` unchanged, with their own `Date.parse` (no import from `eczane/`); `usePharmacy.js` imports them and drops its copy and its `msOf` import; `usePharmacy.test.jsx` is untouched and passes. `useInfection.js` is its own hook with usePharmacy's rules and `isInfectionAnswer` (M9's malformed shapes). `INFECTION_TICK_MS` is `PHARMACY_TICK_MS`.

**N12: The reds that cross the lanes, and the one inside the engine lane.** Both lanes work in one worktree; the dashboard's drift tests read the engine's files as text. Measured in the dry run over the 49 dashboard test files that read engine or deploy sources (`grep -l homunculus-engine` plus `devProxy.test.js`, `src/live/i18n`, `src/live/shell` and `rawKeys.test.jsx`):
- after Task 1 alone, until Task 8 (`2 failed | 1454 passed`): `catalogue.test.js` «has the backend's keys, in the backend's order» and `admin.testutil.test.js` «the permission descriptions are the server's, word for word»;
- with the engine lane complete and the dashboard at Task 1 (`6 failed | 1451 passed`): those two; `apiErrors.test.js` «api/app.py detail: izolasyon bir klinisyen kaydıdır; cihazdan alınmaz» (until Task 15); `engineTypes.test.js` «names every type the engine writes» and «the belt: where a type comes through a variable, …» (until Task 14); `devProxy.test.js` «covers every API path nginx proxies» (until Task 9);
- with the dashboard lane complete and the engine at Task 1 (`2 failed | 1467 passed`, 50 files): `engineTypes.test.js` «finds every way the engine writes a type, …» (its new anchor) and «names no type the engine does not write …» (until Task 5);
- inside the engine lane, between Task 4 and Task 6: `test_board_permissions.py::test_the_table_names_every_board_route_and_only_those`, `test_tenant_isolation.py::test_every_route_resolves_the_callers_tenant_unless_unscoped_by_design`, `test_nginx_routes.py::test_every_app_route_prefix_is_proxied`.
- The dashboard steps' «Expected» lines below are measured with the engine at Task 1 only (the dashboard lane alone); where the engine lane being ahead changes a count, the step says so.
None of these is a code error; each lane commits on its own red, and the gates (Task 18) run both suites whole.

**N13: The migration `0023_infection_view` (spec D21 as §5 A2, M5 amend it).** `down_revision = "0021"`, the head of main; data only (0019's shape: `GROUPS`, `GRANT`, `REVOKE`, one statement per `op.execute`); its test holds `GROUPS` to `DEFAULT_GROUPS`' non-system holders and checks the head by ancestry (`ScriptDirectory.iterate_revisions(head, "base")`), never by the names' order. The docstring's rollback paragraph is 0022's (A2): `alembic downgrade` first, in a one-off container of this release's image, to the server's pre-release head.

**N14: File names.** The spec's `infectionModel.js` / `infectionModel.test.js` are `screens/enfeksiyon/enfeksiyon.js` / `enfeksiyon.test.js` — the folder's name, as `isyuku/isyuku.js` and `ozet/ozet.js`. D14's `useWardList.js` is not built (M9). The fixtures are `enfeksiyon.testutil.js`, built on the kabul ward's ids so the tree and the answer agree.

**N15: The guide.** §3.28, right after §3.27 (before the `---` that precedes «## 4.»); §3.5's count 30 → 31, the newest key `infection.view`. The roadmap row for G4-05 (spec D20) is not in this plan: G3-05 wrote its row after its walk, with the as-built numbers (its `D1` commit); G4-05's is written the same way.

**N16: If TRƏS reaches main first (spec M5).** TRƏS (`feat/tres-esaglik`) also adds a migration on `0021`, `tres.*` keys after `workload.view` and a guide section after §3.27. Whoever reaches main **second** renumbers onto main as it then stands. For this slice that is exactly:
- `homunculus-engine/alembic/versions/0023_infection_view.py` → `0024_infection_view.py`: `revision: str = "0024"`, `down_revision … = "0023"` (TRƏS's), the docstring's «Revision 0023, follows G3-05's 0021», «Can't locate revision identified by '0023'», «Revision ID: 0023» and «Revises: 0021»;
- `homunculus-engine/tests/test_migration_0023_infection_view.py` → `test_migration_0024_infection_view.py`: `CHAIN = ("0024", "0023")`, the path and module name in `_migration()`, the docstring's «Migration 0023» and «0021 → 0023 → 0021 → 0023»;
- the catalogue: `infection.view` stays appended last, after TRƏS's keys — `test_permissions.py`'s `test_the_catalogue_is_exactly_the_specified_thirty_one_keys` and its `assert len(SPEC_KEYS) == 31` take the new count, and the four dashboard mirrors keep the engine's order (`catalogue.js` `PERMISSION_KEYS`, `admin.testutil.js` `PERMISSION_TEXTS`, `perms.js` in four languages). If this slice lands first, TRƏS turns `test_the_infection_page_is_the_wards_clinicians_by_default`'s last line (`assert list(PERMISSIONS)[-1] == "infection.view"`) into the index form the workload test now uses;
- the guide: §3.28 → §3.29 in its heading and in §3.5's line, and §3.5's count;
- the route table's pinned tail (`routes.test.js`, the enfeksiyon block) if TRƏS adds a route; `EVENT_TYPES`' count (`denetim.test.js`) if TRƏS adds audit types; `BOARD_EXPECTED` and `API_PATHS` if TRƏS adds board routes or proxied paths.

**N17: The build.** Measured: precache 73 → 79. New chunks: `EnfeksiyonScreen` (≈ 13.8 kB) and five lifted out of others because two pages now share them — `enfeksiyon` (the model, ≈ 5.3 kB, shared with the patient screen's box), `pharmacyModel` (≈ 2.3 kB) and `usePharmacy` (≈ 1.3 kB, `PHARMACY_TICK_MS`), `ozet` (≈ 8.8 kB, `structureSource` and `WHY`), `numbers` (0.1 kB).

**N18: Left as they are (owner notes).** The chart door with a device token (N1); a BLOCKED isolation bed's reason (Doluluk shows it, S1); the HIS-bed-map disagreement shown as a conflict tile, not mended (A4 a); no tile, alarm row or bed card elsewhere carries an isolation tag (D19).

---

## Execution rules (both lanes; read before Task 0)

- **Code exploration:**
  - `graphify-out/graph.json` lives in the main checkout `C:/Users/User/Desktop/Project/Homunculus AI` and was built from an older branch.
  - Before your first grep or source read for a codebase question, run `graphify query "<question>"` from that directory: `cd "/c/Users/User/Desktop/Project/Homunculus AI" && graphify query "..."`. Then read the **worktree's** files (`C:\tmp\g4-enfeksiyon`) for the current lines.
  - Use `graphify path "<A>" "<B>"` or `graphify explain "<concept>"` for focused questions.
  - **Never run `graphify update`.** A subagent you spawn gets this rule in its prompt.
- **Tests run in the FOREGROUND only.**
  - Never background a test run and wait on it. The tool moves a run past about three minutes to the background: split a long run into chunks instead (the gates do, and a pytest `@argsfile` of node ids or a `-k` expression works). Give the Bash or PowerShell call a timeout above the run's length.
  - Report before you wait on anything.
- **Engine tests** run from `C:\tmp\g4-enfeksiyon\homunculus-engine`, always written out in full (shell variables do not persist between tool calls):
  `"/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest <paths> -q -p no:cacheprovider`
  pytest's `pythonpath = ["src", "tests"]` (pyproject) puts the worktree's `src` ahead of the venv's editable install of the main checkout; Task 0 checks it.
- **Dashboard tests** run from `C:\tmp\g4-enfeksiyon\dashboard`: `npx vitest run <files>`.
  - Reach it as `/c/tmp/g4-enfeksiyon/dashboard` in Bash or `C:\tmp\g4-enfeksiyon\dashboard` in PowerShell — never through a lower-case `c:\…` working directory, which loads vitest twice and fails.
  - `node_modules` is a junction to the shared one and is already present. Two vitest runs at once on it (another session's included) can fail with «Vitest failed to find the current suite»: run again, it is not a code error.
- **Never:**
  - `npm install` or `pip install`;
  - set `DATABASE_URL`. DB tests use `TEST_DATABASE_URL`, and only on the throwaway Postgres below;
  - run `tests/test_infinity_vm_pilot.py`;
  - touch the hospital VM or any SSH host.
- **Git:**
  - Never a bare `git stash`. Never `git add -A`, never `git commit -a`.
  - Every commit names its paths, run from `C:\tmp\g4-enfeksiyon`:
    `git add <paths>`, then `git commit -m "<subject>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- <paths>`.
    The pathspec matters: the other lane may have files staged at the same moment, and `git commit -- <paths>` commits only yours. A new file must be `git add`ed before the pathspec commit can name it.
  - If `.git/index.lock` exists, the other lane is committing: wait a few seconds and retry. **Never delete it.**
  - Do not push, do not merge.
- **Line endings and editing:** `core.autocrlf=true`, so tracked files are CRLF in the working tree.
  - Edit existing files with the **Edit** tool, or with a `python -I -X utf8` script that writes `\r\n`.
  - Create new files with the **Write** tool.
  - **Never** write code with a Bash heredoc: the Bash tool mangles backslashes in heredocs.
- **Find blocks:** every **find** block below occurs **exactly once** in its file at that point of the plan (checked on a scratch copy of `ebadfb01` when the plan was written, by applying the plan's own blocks in order — plan note N12 and the self-review). If one does not match, stop and report; do not guess.
- **A «Fact-Forcing Gate» hook** may ask for facts before a file write or a command: state them (the file, its purpose, the task and step of this plan) and retry.
- **No patient data:** synthetic ids only (`S-101`, `p-a1`, `192.0.2.x`), synthetic names (`Ayşe Sentetik`, `Örnek Hasta Bir`).

### The throwaway Postgres (DB-backed tests: Tasks 5, 7 and 18)

The DB tests drop every table, so they run only against a private, disposable database. **Never use the shared `56432`**, nor another session's container. Each line is one foreground tool call, from `C:\tmp\g4-enfeksiyon\homunculus-engine`:

```bash
docker run -d --rm --name enfeksiyon-pg -p 127.0.0.1:56460:5432 -e POSTGRES_PASSWORD=ozet -e POSTGRES_DB=ozet postgres:16
timeout 60 bash -c 'until docker exec enfeksiyon-pg createdb -U postgres ozet_test 2>/dev/null; do :; done'
TEST_DATABASE_URL=postgresql+asyncpg://postgres:ozet@127.0.0.1:56460/ozet_test "/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest <paths> -q -p no:cacheprovider
docker stop enfeksiyon-pg
```

- `pg_isready` answers before the server is really up (during its init it restarts); retrying `createdb` until it succeeds is the reliable wait.
- If `docker ps` fails, Docker Desktop is not running: say so and do the steps that need no database first.
- The `TEST_DATABASE_URL=… python …` prefix sets the variable for that one command only. The database name must contain `test` (`tests/conftest.py` refuses any other).
- Run one pytest at a time against it: two concurrent runs corrupt each other.
- Always `docker stop enfeksiyon-pg` at the end, even after a failure. `--rm` then deletes it.

## Order, lanes and file ownership

1. **Task 0** (each implementer): preflight.
2. **Task 1** (engine implementer, **alone, first**): the key `infection.view` and its five default groups. After its commit, two dashboard tests go red until Task 8 by design (plan note N12).
3. **In parallel:** the engine lane (Tasks 2→3→4→5→6→7) and the dashboard lane (Tasks 8→9→10→11→12→13→14→15→16). The two lanes share **no file**; N12 lists the reds that cross them by design.
4. **Task 17** (docs), then **Task 18** (gates).

| Lane | Tasks | Files (only these) |
|---|---|---|
| Engine | 1–7 | `homunculus-engine/src/homunculus/auth/permissions.py`, `homunculus-engine/tests/test_permissions.py`, `homunculus-engine/src/homunculus/canonical.py`, `homunculus-engine/src/homunculus/api/clinical.py`, `homunculus-engine/src/homunculus/api/app.py`, `homunculus-engine/tests/test_canonical.py`, `homunculus-engine/tests/test_isolation_chart.py` (new), `homunculus-engine/src/homunculus/api/board.py`, `homunculus-engine/tests/test_api_board_isolation.py` (new), `homunculus-engine/src/homunculus/api/infection.py` (new), `homunculus-engine/tests/test_infection.py` (new), `homunculus-engine/tests/test_infection_api.py` (new), `homunculus-engine/src/homunculus/tenant/schemas.py`, `homunculus-engine/src/homunculus/tenant/router.py`, `homunculus-engine/tests/test_structure_api.py`, `homunculus-engine/tests/test_board_permissions.py`, `homunculus-engine/tests/test_tenant_isolation.py`, `homunculus-engine/tests/test_nginx_routes.py`, `deploy/local/web/nginx.conf`, `homunculus-engine/alembic/versions/0023_infection_view.py` (new), `homunculus-engine/tests/test_migration_0023_infection_view.py` (new) |
| Dashboard | 8–16 | `dashboard/src/live/i18n/enfeksiyon.strings.test.js` (new), `dashboard/src/live/i18n/strings/enfeksiyon.js` (new), `dashboard/src/live/i18n/catalog.js`, `dashboard/src/live/i18n/strings/perms.js`, `dashboard/src/live/screens/admin/catalogue.js`, `dashboard/src/live/screens/admin/admin.testutil.js`, `dashboard/src/backendApi.js`, `dashboard/src/backendApi.test.js`, `dashboard/src/live/session/testTokens.testutil.js`, `dashboard/vite.config.js`, `dashboard/src/live/screens/common/skewAtReceipt.js` (new), `dashboard/src/live/screens/eczane/usePharmacy.js`, `dashboard/src/live/screens/enfeksiyon/enfeksiyon.testutil.js` (new), `dashboard/src/live/screens/enfeksiyon/useInfection.js` (new), `dashboard/src/live/screens/enfeksiyon/useInfection.test.jsx` (new), `dashboard/src/live/data/structure.js`, `dashboard/src/live/data/structure.test.js`, `dashboard/src/live/screens/enfeksiyon/enfeksiyon.js` (new), `dashboard/src/live/screens/enfeksiyon/enfeksiyon.test.js` (new), `dashboard/src/live/screens/enfeksiyon/EnfeksiyonScreen.jsx` (new), `dashboard/src/live/screens/enfeksiyon/EnfeksiyonScreen.test.jsx` (new), `dashboard/src/live/screens/patient/IsolationBox.jsx` (new), `dashboard/src/live/screens/patient/IsolationBox.test.jsx` (new), `dashboard/src/live/screens/patient/PatientScreen.jsx`, `dashboard/src/live/screens/patient/PatientScreen.test.jsx`, `dashboard/src/live/i18n/strings/patient.js`, `dashboard/src/liveAdapters.js`, `dashboard/src/liveAdapters.test.js`, `dashboard/src/live/screens/admin/StructureTab.jsx`, `dashboard/src/live/screens/admin/StructureTab.test.jsx`, `dashboard/src/live/i18n/strings/kabul.js`, `dashboard/src/live/screens/denetim/denetim.js`, `dashboard/src/live/i18n/strings/denetim.js`, `dashboard/src/live/screens/denetim/denetim.test.js`, `dashboard/src/live/screens/denetim/engineTypes.test.js`, `dashboard/src/live/apiErrors.js`, `dashboard/src/live/i18n/strings/errors.js`, `dashboard/src/live/apiErrors.test.js`, `dashboard/src/live/shell/routes.js`, `dashboard/src/live/shell/routes.test.js`, `dashboard/src/live/rawKeys.test.jsx` |
| Docs (after both) | 17 | `docs/homunculus-rehber-TR.md` |
| Gates (last) | 18 | none (fixes go back to the owning lane) |
| Not touched, owned all the same | — | `dashboard/src/live/screens/eczane/usePharmacy.test.jsx` (must pass unchanged, §5 M9) and `homunculus-engine/src/homunculus/api/pharmacy.py` (§5 M4) are the dashboard's and the engine's lane's respectively, and neither is edited. `vite.config.js` is the dashboard lane's and `nginx.conf` the engine lane's: if a merge ever asks for a change to one, only its owner makes it. |

The dashboard lane never needs the engine running: its tests use fixtures in the contract's shape below.

## The shared contract

**The key** (Task 1; mirrored by Task 8):

| Where | Text |
|---|---|
| `auth/permissions.py` `PERMISSIONS["infection.view"]`, appended after `workload.view` (the 31st key) | `"Open the Enfeksiyon kontrol page: per patient in one's own units — isolation, suspected infection, the antibiotic clock and open sepsis alarms — and the isolation beds, read-only (GET /infection)"` |
| `catalogue.js` `PERMISSION_KEYS` | `"infection.view"`, last |
| `admin.testutil.js` `PERMISSION_TEXTS` | the text, word for word |
| `perms.js` | tr «“Enfeksiyon kontrol” sayfasını açar: kendi birimlerindeki hastaların izolasyonunu, şüpheli enfeksiyonu, antibiyotik süresini, açık sepsis alarmlarını ve izolasyon yataklarını salt okunur görür» (Task 8 Step 4 has all four) |
| Default groups | `attending` (`_ATTENDING`, so `unit_physician` too), `physician`, `charge_nurse`, `nurse`: `DEFAULT_GROUPS` for a tenant made later, migration `0023` for the ones seeded before; `hospital_admin` by rule |

**The four chart codes** (Task 2): `isolation_contact`, `isolation_droplet`, `isolation_airborne`, `isolation_protective` — that order everywhere (`api/clinical.py` `ISOLATION_CODES`; the dashboard's `enfeksiyon.js` `TYPES` = the names after `isolation_`). `POST /clinical/{patient_id}` with `clinical.chart`, value 0 / 1 / `true` / `false`, unit `"bool"`; with a `recorded_at`, at most 24 h back and 2 min ahead. `POST /ingest` with one of them: **400 `{"detail": "izolasyon bir klinisyen kaydıdır; cihazdan alınmaz"}`**, nothing written.

**The board card's block** (Task 3; read by Task 13 through `liveAdapters`):

```json
"isolation": {"contact": true, "droplet": true, "airborne": false, "protective": null,
              "types": ["contact", "droplet"], "state": "isolated", "charted_at": "2026-11-12T08:10:00+00:00"}
```

`state` ∈ `isolated` | `not_isolated` | `unrecorded`; a flag is `null` when never charted. An identity-only card carries `"isolation": null`. No person anywhere.

**`GET /infection`** (Task 4) — guard `infection.view`; the device token passes:

```json
{"now": "2026-11-12T09:30:00+00:00",
 "antibiotic_window_min": 60, "antibiotic_window_source": "surviving-sepsis-campaign-2026",
 "counts": {"patients": 5, "isolated": 2, "isolation_unrecorded": 2, "suspected": 2, "suspected_unrecorded": 3,
            "clock_missed": 1, "sepsis_open": 1},
 "units": [{"unit_id": "u1", "counts": {"patients": 5, "isolated": 2, "isolation_unrecorded": 2, "suspected": 2,
                                        "suspected_unrecorded": 3, "clock_missed": 1, "sepsis_open": 1}}],
 "isolated": [{"patient_id": "S-101", "bed_label": "İzo 1", "bed_id": "b9", "unit_id": "u1", "display_name": "Ayşe Sentetik",
               "isolation": {"state": "isolated", "types": ["contact", "droplet"], "charted_at": "2026-11-12T08:10:00+00:00"},
               "suspected_infection": true,
               "antibiotic": {"state": "met", "given": true, "given_at": "2026-11-12T06:40:00+00:00",
                              "recognized_at": "2026-11-12T06:00:00+00:00", "deadline": "2026-11-12T07:00:00+00:00",
                              "remaining_sec": null},
               "sepsis_alarms": [], "sort_group": 2}],
 "suspected": [{"patient_id": "S-103", "…": "a row as above",
                "sepsis_alarms": [{"kind": "septic_shock", "severity": "critical", "first_seen_at": "2026-11-12T08:20:00+00:00",
                                   "resolved_at": null, "acknowledged": false, "snooze_until": null}],
                "sort_group": 0}],
 "bed_occupants": [{"bed_id": "b9", "patient_id": "S-101", "display_name": "Ayşe Sentetik",
                    "isolation": {"state": "isolated", "types": ["contact", "droplet"]}}],
 "scope": {"…": "/patients' own"}, "scope_note": null}
```

| Field | Meaning |
|---|---|
| `counts` | over the scoped cards: `patients`; `isolated` / `isolation_unrecorded` (isolation state `isolated` / `unrecorded`, an identity-only card counted unrecorded); `suspected` / `suspected_unrecorded` (`suspected_infection` true / null — a card with no `sepsis` block is null); `clock_missed` (antibiotic `missed`); `sepsis_open` (patients with a FIRING alarm of the three kinds, acknowledged or snoozed or not) |
| `units[]` | one per unit a scoped card is on, by unit id, with that unit's `counts`; a card on no unit counts only in `counts` |
| `isolated` | the rows in isolation, by patient key |
| `suspected` | the rows with `suspected_infection` true or any listed alarm (firing or latched), by patient key |
| a row | bed and name as Eczane's; `isolation` without the raw flags; `antibiotic` = `pharmacy.antibiotic_of(card.meds)`; `sepsis_alarms` of `septic_shock`, `sepsis`, `under_resuscitated_sepsis` in that order; `sort_group` 0 / 1 / 2 (N3) |
| `bed_occupants` | one per scoped card with a `bed_id`, by patient key |

Errors: 401; 403 `permission required: infection.view`; 503 `kapsam şu anda okunamıyor`. Not audited.

**The room's isolation mark** (Task 5; written by Task 14): `PATCH /tenant/rooms/{room_id}` `{"is_isolation": true | false}` (`structure.manage`); answers the room (`RoomResponse.is_isolation`). A change writes one audit row `structure.isolation` with payload `{"kind": "room", "id", "unit_id", "old_is_isolation", "new_is_isolation", "actor"}`; the same value writes none; a rename sent with it writes its own `structure.rename` beside it.

`dashboard/src/live/screens/enfeksiyon/enfeksiyon.testutil.js` (Task 10) holds the dashboard's synthetic answers in these shapes.

## File map

**Engine**
- `auth/permissions.py`: `infection.view`, the five groups (Task 1).
- `canonical.py` the four codes; `api/clinical.py` `CHARTABLE`, `ISOLATION_CODES`, `_BOOLEAN`, `_check_bedside`; `api/app.py` `/ingest`'s refusal (Task 2).
- `api/board.py` `_isolation`, the card's and the identity-only card's `isolation` (Task 3).
- `api/infection.py` (new: `SEPSIS_KINDS`, `ISOLATED`, `NOT_ISOLATED`, `UNRECORDED`, `isolation_of`, `suspected_of`, `sepsis_alarms_of`, `row_of`, `counts_of`, `ward_infection`); `api/app.py` `INFECTION_VIEW`, `GET /infection` (Task 4).
- `tenant/schemas.py` `RoomPatch.is_isolation`; `tenant/router.py` `_changes`, `patch_room` (Task 5).
- `deploy/local/web/nginx.conf` (Task 6); `alembic/versions/0023_infection_view.py` (new: `KEY`, `GROUPS`, `GRANT`, `REVOKE`) (Task 7).
- Tests: `test_permissions.py` (Task 1); `test_canonical.py`, `test_isolation_chart.py` (new) (Task 2); `test_api_board_isolation.py` (new) (Task 3); `test_infection.py`, `test_infection_api.py` (new) (Task 4); `test_structure_api.py` (DB) (Task 5); `test_board_permissions.py`, `test_tenant_isolation.py`, `test_nginx_routes.py` (Task 6); `test_migration_0023_infection_view.py` (new; one no-DB test, three DB-backed) (Task 7).

**Dashboard**
- `i18n/strings/enfeksiyon.js` (new) and its entries in `catalog.js`; `i18n/enfeksiyon.strings.test.js` (new); `perms.js`, `catalogue.js`, `admin.testutil.js`: the key's mirrors (Task 8).
- `backendApi.js` `infection()`, its test, `fakeApi`'s mock; `vite.config.js`'s proxy; `screens/common/skewAtReceipt.js` (new: `SKEW_NOISE_MS`, `skewAtReceipt`) and `usePharmacy.js`'s import (Task 9).
- `screens/enfeksiyon/enfeksiyon.testutil.js` (new), `useInfection.js` (new: `INFECTION_TICK_MS`, `isInfectionAnswer`, `useInfection`) and its test (Task 10).
- `data/structure.js` `isIsolation`; `screens/enfeksiyon/enfeksiyon.js` (new: `ALL`, `TYPES`, `TILES`, `tileOf`, `isolationBeds`, `bedTally`, `unitChoices`, `selectionOf`, `unitOf`, `sortRows`, `roomCell`, `countCell`, `freeBedsCell`, `tileWords`, `alarmItems`) and its test (Task 11).
- `screens/enfeksiyon/EnfeksiyonScreen.jsx` (new) and its test (Task 12).
- `screens/patient/IsolationBox.jsx` (new: `seedOf`, `IsolationBox`) and its test; `PatientScreen.jsx` and its test; `i18n/strings/patient.js` (`onlyWrite`, `isolation.*`); `liveAdapters.js` `isolation` and its test (Task 13).
- `screens/admin/StructureTab.jsx` (`Node`'s `action`, the room's button) and its test; `i18n/strings/kabul.js`; `screens/denetim/denetim.js` `EVENT_TYPES`, `i18n/strings/denetim.js`, `denetim.test.js`, `engineTypes.test.js` (Task 14).
- `apiErrors.js`, `i18n/strings/errors.js`, `apiErrors.test.js`: `isolationFromDevice` (Task 15).
- `shell/routes.js`, `shell/routes.test.js`, `rawKeys.test.jsx` (Task 16).

**Docs**
- `docs/homunculus-rehber-TR.md`: §3.28, and the permission count in §3.5 «İzin» (Task 17).

---

## Task 0: Preflight (each implementer, once)

**Files:** none.

- [ ] **Step 1: Check the worktree**

Run: `cd /c/tmp/g4-enfeksiyon && git status --short && git log --oneline -3`
Expected: no changes listed, on branch `feat/g4-enfeksiyon`. The head is this plan's commit; below it `ebadfb01 docs(spec): G4-05 «Enfeksiyon» §5 …` and `9710129e docs(spec): G4-05 «Enfeksiyon» …`.

- [ ] **Step 2 (engine lane): Check that pytest imports the worktree's code**

Run: `cd /c/tmp/g4-enfeksiyon/homunculus-engine && "/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -c "import sys; sys.path.insert(0, 'src'); import homunculus; print(homunculus.__file__)"`
Expected: `C:\tmp\g4-enfeksiyon\homunculus-engine\src\homunculus\__init__.py`. Anything under `Desktop\Project` means the tests would exercise the main checkout: stop and report.

- [ ] **Step 3 (dashboard lane): Check the toolchain**

Run: `cd /c/tmp/g4-enfeksiyon/dashboard && ls node_modules/.bin/vitest && npx vitest run src/live/shell/routes.test.js`
Expected: the file exists, and `Tests  52 passed (52)` (one file).

- [ ] **Step 4: Run graphify once for your lane** (rule above). For example:
  - engine: `graphify query "SignalCode CHARTABLE _BOOLEAN _check_bedside RETRACTABLE_CODES patient_board identity_only_board _board_for ward_pharmacy antibiotic_of RoomPatch patch_room _changes"`;
  - dashboard: `graphify query "usePharmacy pharmacyModel antibioticCell EczaneScreen PatientScreen Sepsis StructureTab indexStructure structureSource useUnitNames routes EVENT_TYPES API_MESSAGE_KEYS"`.

The graph predates these files, so expect little; read the worktree after.

---

# Engine lane

## Task 1 (engine, first and alone): the key `infection.view`, held by the five default groups of the ward's clinicians

**Files:**
- Modify: `homunculus-engine/src/homunculus/auth/permissions.py` (end of `PERMISSIONS`, after `workload.view`; `_ATTENDING`; the `physician`, `charge_nurse` and `nurse` entries of `DEFAULT_GROUPS`)
- Test: `homunculus-engine/tests/test_permissions.py` (`SPEC_KEYS`, the count test, `SPEC_GROUPS`, the workload test's last line, end of file)

- [ ] **Step 1: Write the failing tests**

In `homunculus-engine/tests/test_permissions.py`, find:

```python
    "workload.view",      # G4-04 İş yükü (spec D2): the page, GET /shift-schedule
}


def test_the_catalogue_is_exactly_the_specified_thirty_keys():
    assert len(SPEC_KEYS) == 30
```

Replace with:

```python
    "workload.view",      # G4-04 İş yükü (spec D2): the page, GET /shift-schedule
    "infection.view",     # G4-05 Enfeksiyon kontrol (spec D2, D9): the page, GET /infection
}


def test_the_catalogue_is_exactly_the_specified_thirty_one_keys():
    assert len(SPEC_KEYS) == 31
```

Then find:

```python
    "attending": (True, False, {"board.view", "alerts.ack", "alerts.escalate", "admissions.view",
                                "admissions.sign_off", "admissions.move.initiate",
                                "care_team.claim", "care_team.assign", "handover.sign",
                                "break_glass.use", "clinical.chart", "scores.sign",
                                "tasks.view", "tasks.manage", "pharmacy.view"}),
    "unit_physician": (True, False, {"board.view", "alerts.ack", "alerts.escalate",
                                     "admissions.view", "admissions.sign_off",
                                     "admissions.move.initiate", "handover.sign",
                                     "break_glass.use", "clinical.chart", "scores.sign",
                                     "tasks.view", "tasks.manage", "pharmacy.view"}),
    "physician": (False, False, {"board.view", "alerts.ack", "alerts.escalate", "admissions.view",
                                 "handover.sign", "break_glass.use", "clinical.chart",
                                 "scores.sign", "tasks.view", "tasks.manage", "pharmacy.view"}),
    "charge_nurse": (False, False, {"board.view", "alerts.ack", "alerts.escalate",
                                    "admissions.view", "admissions.admit",
                                    "admissions.transfer.confirm", "admissions.discharge.confirm",
                                    "handover.sign", "shifts.manage",
                                    "break_glass.use", "clinical.chart", "beds.release",
                                    "devices.map_beds", "beds.manage_state", "tasks.view", "tasks.manage",
                                    "workload.view"}),                       # + G4-04 (spec D2)
    "nurse": (False, False, {"board.view", "alerts.ack", "admissions.view", "admissions.admit",
                             "admissions.transfer.confirm", "handover.sign",
                             "clinical.chart", "beds.release", "tasks.view", "tasks.manage"}),
```

Replace with:

```python
    # G4-05 (spec D2): + `infection.view` for the five groups of the ward's clinicians (migration 0023).
    "attending": (True, False, {"board.view", "alerts.ack", "alerts.escalate", "admissions.view",
                                "admissions.sign_off", "admissions.move.initiate",
                                "care_team.claim", "care_team.assign", "handover.sign",
                                "break_glass.use", "clinical.chart", "scores.sign",
                                "tasks.view", "tasks.manage", "pharmacy.view", "infection.view"}),
    "unit_physician": (True, False, {"board.view", "alerts.ack", "alerts.escalate",
                                     "admissions.view", "admissions.sign_off",
                                     "admissions.move.initiate", "handover.sign",
                                     "break_glass.use", "clinical.chart", "scores.sign",
                                     "tasks.view", "tasks.manage", "pharmacy.view", "infection.view"}),
    "physician": (False, False, {"board.view", "alerts.ack", "alerts.escalate", "admissions.view",
                                 "handover.sign", "break_glass.use", "clinical.chart",
                                 "scores.sign", "tasks.view", "tasks.manage", "pharmacy.view",
                                 "infection.view"}),
    "charge_nurse": (False, False, {"board.view", "alerts.ack", "alerts.escalate",
                                    "admissions.view", "admissions.admit",
                                    "admissions.transfer.confirm", "admissions.discharge.confirm",
                                    "handover.sign", "shifts.manage",
                                    "break_glass.use", "clinical.chart", "beds.release",
                                    "devices.map_beds", "beds.manage_state", "tasks.view", "tasks.manage",
                                    "workload.view",                         # + G4-04 (spec D2)
                                    "infection.view"}),
    "nurse": (False, False, {"board.view", "alerts.ack", "admissions.view", "admissions.admit",
                             "admissions.transfer.confirm", "handover.sign",
                             "clinical.chart", "beds.release", "tasks.view", "tasks.manage",
                             "infection.view"}),
```

Then find (the end of the file):

```python
    assert PERMISSIONS["shifts.manage"].startswith("Assign nurses to beds")
    assert list(PERMISSIONS)[-1] == "workload.view"          # appended after quality.view: the mirrors' order
```

Replace with:

```python
    assert PERMISSIONS["shifts.manage"].startswith("Assign nurses to beds")
    keys = list(PERMISSIONS)                                 # G4-05: infection.view is the last key now
    assert keys[keys.index("quality.view") + 1] == "workload.view"   # appended after quality.view: the mirrors' order


def test_the_infection_page_is_the_wards_clinicians_by_default():
    """G4-05 (spec D2, D9): `infection.view` is in the default groups of the ward's clinicians — the attending
    («Sorumlu Hekim»), the unit physician, the physician, the charge nurse and the nurse — migration 0023 gives it to
    the tenants seeded before it, `DEFAULT_GROUPS` to the ones made after — and the system group holds it by rule. Not
    the pharmacist's, the rapid-response team's, the auditor's, vendor support's or biomedical's. The page writes
    nothing: charting a flag needs `clinical.chart`, the chart door's own key."""
    holders = {g["slug"] for g in DEFAULT_GROUPS if "infection.view" in g["permissions"]}
    assert holders == {"hospital_admin", "attending", "unit_physician", "physician", "charge_nurse", "nurse"}
    assert PERMISSIONS["infection.view"].startswith("Open the Enfeksiyon kontrol page")
    assert PERMISSIONS["infection.view"].endswith("read-only (GET /infection)")
    assert list(PERMISSIONS)[-1] == "infection.view"         # appended after workload.view: the mirrors' order
```

(`SPEC_GROUPS["hospital_admin"]` is built from `SPEC_KEYS`, so the spec-table test follows on its own.)

- [ ] **Step 2: Run them to see them fail**

Run: `cd /c/tmp/g4-enfeksiyon/homunculus-engine && "/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest tests/test_permissions.py -q -p no:cacheprovider`
Expected: `4 failed, 20 passed`:
- `test_the_catalogue_is_exactly_the_specified_thirty_one_keys`;
- `test_hospital_admin_holds_every_permission`;
- `test_every_default_group_matches_the_spec_table_exactly`;
- `test_the_infection_page_is_the_wards_clinicians_by_default`.

- [ ] **Step 3: Add the key and give it to the five groups**

In `homunculus-engine/src/homunculus/auth/permissions.py`, find:

```python
    "workload.view": "Open the İş yükü page and read each unit's workload for the current shift — patients, "
                     "nurses, unassigned patients, late and remaining tasks, alarms waiting — as counts, and "
                     "the shift's nurse–bed assignment (GET /shift-schedule)",
}
```

Replace with:

```python
    "workload.view": "Open the İş yükü page and read each unit's workload for the current shift — patients, "
                     "nurses, unassigned patients, late and remaining tasks, alarms waiting — as counts, and "
                     "the shift's nurse–bed assignment (GET /shift-schedule)",

    # G4-05 — Enfeksiyon kontrol (spec D2, D9): the infection-control page, read-only. The default groups of the ward's
    # clinicians hold it — attending, unit physician, physician, charge nurse, nurse (migration 0023 for the tenants
    # seeded before it); the system group holds it by rule. Charting a flag is `clinical.chart`'s, not this key's.
    "infection.view": "Open the Enfeksiyon kontrol page: per patient in one's own units — isolation, suspected "
                      "infection, the antibiotic clock and open sepsis alarms — and the isolation beds, "
                      "read-only (GET /infection)",
}
```

(The dashboard's `admin.testutil.test.js` folds the adjacent strings into one: keep each on a line that begins with spaces and a `"`, and end the entry with `",`. No `"` inside a text.)

Then find:

```python
    "break_glass.use", "clinical.chart", "scores.sign", "tasks.view", "tasks.manage",
    "pharmacy.view",
)
```

Replace with:

```python
    "break_glass.use", "clinical.chart", "scores.sign", "tasks.view", "tasks.manage",
    "pharmacy.view",
    "infection.view",       # G4-05 (spec D2): «Enfeksiyon kontrol»; migration 0023 for the tenants seeded before
)
```

Then find:

```python
                     "handover.sign", "break_glass.use", "clinical.chart", "scores.sign",
                     "tasks.view", "tasks.manage", "pharmacy.view")},
```

Replace with:

```python
                     "handover.sign", "break_glass.use", "clinical.chart", "scores.sign",
                     "tasks.view", "tasks.manage", "pharmacy.view",
                     "infection.view")},                 # G4-05 (spec D2)
```

Then find:

```python
                     "devices.map_beds", "beds.manage_state", "tasks.view", "tasks.manage",
                     "workload.view")},
```

Replace with:

```python
                     "devices.map_beds", "beds.manage_state", "tasks.view", "tasks.manage",
                     "workload.view",
                     "infection.view")},                 # G4-05 (spec D2)
```

Then find:

```python
     "permissions": ("board.view", "alerts.ack", "admissions.view", "admissions.admit",
                     "admissions.transfer.confirm", "handover.sign", "clinical.chart",
                     "beds.release", "tasks.view", "tasks.manage")},
```

Replace with:

```python
     "permissions": ("board.view", "alerts.ack", "admissions.view", "admissions.admit",
                     "admissions.transfer.confirm", "handover.sign", "clinical.chart",
                     "beds.release", "tasks.view", "tasks.manage",
                     "infection.view")},                 # G4-05 (spec D2)
```

(`unit_physician` is `_ATTENDING` without the care-team keys, so it follows the attending. No group's description changes.)

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd /c/tmp/g4-enfeksiyon/homunculus-engine && "/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest tests/test_permissions.py tests/test_merge_permissions.py tests/test_groups_service.py -q -p no:cacheprovider`
Expected: `39 passed, 27 skipped` (the skips are DB-backed).

- [ ] **Step 5: Commit**

```bash
cd /c/tmp/g4-enfeksiyon && git add homunculus-engine/src/homunculus/auth/permissions.py homunculus-engine/tests/test_permissions.py && git commit -m "feat(auth): G4-05 infection.view — the Enfeksiyon kontrol page's key (the 31st, after workload.view), held by the default attending, unit-physician, physician, charge-nurse and nurse groups (migration 0023 for the tenants seeded before) and by the system group by rule" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- homunculus-engine/src/homunculus/auth/permissions.py homunculus-engine/tests/test_permissions.py
```

Then tell the dashboard implementer that Task 1 is committed: the lanes may start.

---

## Task 2 (engine): the four isolation flags at the chart door, refused at the device door

**Files:**
- Modify: `homunculus-engine/src/homunculus/canonical.py` (the «Clinical context» block)
- Modify: `homunculus-engine/src/homunculus/api/clinical.py` (`CHARTABLE`, `ISOLATION_CODES`, `_BOOLEAN`, `_check_bedside`)
- Modify: `homunculus-engine/src/homunculus/api/app.py` (the clinical import; `/ingest` right after `parse_fhir_observation`)
- Test: `homunculus-engine/tests/test_canonical.py` (end of file)
- Test: `homunculus-engine/tests/test_isolation_chart.py` (new, no DB)

- [ ] **Step 1: Write the failing tests**

In `homunculus-engine/tests/test_canonical.py`, find (the end of the file):

```python
    names = {c.name for c in SignalCode}
    assert required <= names
```

Replace with:

```python
    names = {c.name for c in SignalCode}
    assert required <= names


def test_the_four_isolation_flags_are_signal_codes():
    """G4-05 (spec D3, D7): the patient's isolation precautions, as a clinician charts them — no rule reads them."""
    assert [c.value for c in (SignalCode.ISOLATION_CONTACT, SignalCode.ISOLATION_DROPLET,
                              SignalCode.ISOLATION_AIRBORNE, SignalCode.ISOLATION_PROTECTIVE)] == [
        "isolation_contact", "isolation_droplet", "isolation_airborne", "isolation_protective"]
```

Create `homunculus-engine/tests/test_isolation_chart.py` with:

```python
# homunculus-engine/tests/test_isolation_chart.py
"""G4-05 «Enfeksiyon kontrol» (spec D3, D7, §5 M8): the four isolation flags at the two doors. At the chart door
(POST /clinical/{id}) each is a flag like the suspected-infection mark — 0 / 1 / true / false and nothing else, recorded
as "bool" by the clinician — held to the bedside time bound when a time is sent, never withdrawable as «hatalı giriş» and
never filed in the measurement record. At the device door (POST /ingest) each is refused before anything is written:
a monitor or the HIS cannot decide isolation. Synthetic patients and values only (CLAUDE.md rule 6)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from homunculus.api.app import create_app
from homunculus.api.audit import InMemoryAuditLog
from homunculus.api.clinical import (
    AT_FUTURE, AT_TOO_OLD, CHARTABLE, ISOLATION_CODES, RETRACT_NOT_BEDSIDE, RETRACTABLE_CODES, ClinicalEntryError,
    build_entries,
)
from homunculus.api.identity import Caller
from homunculus.api.readings import MANUAL_CODES, POLICY_UNMATCHED, InMemoryReadingStore
from tests.test_ingest_apply import obs

TOKEN = "tok"
DEVICE = {"Authorization": f"Bearer {TOKEN}"}
NURSE = {"Authorization": "Bearer nurse-jwt"}
PEOPLE = {"nurse-jwt": Caller(hospital="h1", actor="hem.ayse", groups=("nurse",),
                              perms=frozenset({"board.view", "clinical.chart"}))}
SLUGS = ["isolation_contact", "isolation_droplet", "isolation_airborne", "isolation_protective"]
#: api/app.py `/ingest`'s refusal, word for word (the dashboard maps this exact sentence: apiErrors.js).
REFUSED = "izolasyon bir klinisyen kaydıdır; cihazdan alınmaz"


async def _resolve(credential: str):
    return PEOPLE.get(credential)


def _app(**kw):
    return create_app({TOKEN: "h1"}, run_escalation_loop=False, resolve_jwt=_resolve, **kw)


@pytest.fixture()
def world():
    audit, readings = InMemoryAuditLog(), InMemoryReadingStore()
    with TestClient(_app(audit=audit, readings=readings)) as client:
        yield client, audit, readings


def _ago(minutes: float) -> str:
    return (datetime.now(timezone.utc) - timedelta(minutes=minutes)).isoformat()


def _chart(client, entries, at=None, pid="S-101"):
    body = {"entries": entries}
    if at is not None:
        body["recorded_at"] = at
    return client.post(f"/clinical/{pid}", json=body, headers=NURSE)


def _filed(readings) -> list:
    """Every row of the measurement record for S-101 over the last two days — and the unmatched list."""
    now = datetime.now(timezone.utc)
    return (readings.for_patient("h1", "S-101", since=now - timedelta(days=2), until=now + timedelta(hours=1))
            + readings.unmatched("h1", since=now - timedelta(days=2)))


class TestTheFourFlags:
    def test_they_are_chartable_flags_in_one_order(self):
        assert [code.value for code in ISOLATION_CODES] == SLUGS
        for code in ISOLATION_CODES:
            assert CHARTABLE[code] == "bool", code

    @pytest.mark.parametrize("slug", SLUGS)
    @pytest.mark.parametrize("raw,value", [(0, 0.0), (1, 1.0), (True, 1.0), (False, 0.0)])
    def test_each_takes_0_1_true_and_false(self, slug, raw, value):
        (entry,) = build_entries("S-101", [{"code": slug, "value": raw}], charted_by="hem.ayse")
        assert (entry.observation.code.value, entry.observation.value, entry.observation.unit) == (slug, value, "bool")
        assert (entry.observation.source_device, entry.charted_by) == ("clinician", "hem.ayse")

    @pytest.mark.parametrize("slug", SLUGS)
    def test_anything_else_is_refused_with_the_doors_own_sentence(self, slug):
        for raw in (0.5, 2, -1):
            with pytest.raises(ClinicalEntryError, match=f"^{slug}: yalnız 0 veya 1 olabilir$"):
                build_entries("S-101", [{"code": slug, "value": raw}], charted_by="hem.ayse")

    def test_a_save_of_the_four_writes_four_chart_rows_under_the_nurses_name(self, world):
        client, audit, _ = world
        r = _chart(client, [{"code": slug, "value": v} for slug, v in zip(SLUGS, (1, 1, 0, 0))])
        assert r.status_code == 200, r.text
        assert r.json()["charted"] == 4
        rows = [rec for rec in audit.records(tenant="h1", limit=100) if rec.event_type == "chart"]
        assert [(rec.subject, rec.payload["value"], rec.payload["unit"], rec.payload["charted_by"]) for rec in rows] == [
            ("isolation_contact", 1.0, "bool", "hem.ayse"), ("isolation_droplet", 1.0, "bool", "hem.ayse"),
            ("isolation_airborne", 0.0, "bool", "hem.ayse"), ("isolation_protective", 0.0, "bool", "hem.ayse")]

    def test_half_a_flag_through_the_door_is_a_400_that_writes_nothing(self, world):
        client, audit, _ = world
        r = _chart(client, [{"code": "isolation_contact", "value": 1}, {"code": "isolation_droplet", "value": 0.5}])
        assert (r.status_code, r.json()["detail"]) == (400, "isolation_droplet: yalnız 0 veya 1 olabilir")
        assert audit.records(tenant="h1", limit=100) == []


class TestTheTimeBound:
    @pytest.mark.parametrize("slug", SLUGS)
    def test_a_time_ahead_or_more_than_a_day_back_is_refused_and_writes_nothing(self, world, slug):
        """Spec D7: a flag stamped tomorrow would stay the latest value, and no save today could end the isolation."""
        client, audit, _ = world
        ahead = (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat()
        r = _chart(client, [{"code": slug, "value": 1}], at=ahead)
        assert (r.status_code, r.json()["detail"]) == (400, AT_FUTURE)
        r = _chart(client, [{"code": slug, "value": 1}], at=_ago(25 * 60))
        assert (r.status_code, r.json()["detail"]) == (400, AT_TOO_OLD)
        assert audit.records(tenant="h1", limit=100) == []
        assert _chart(client, [{"code": slug, "value": 1}], at=_ago(60)).status_code == 200

    def test_a_suspected_infection_mark_keeps_todays_rule(self, world):
        """Unchanged: the bound is opened to the four flags only (spec D7), not to every code of the door."""
        client, _, _ = world
        assert _chart(client, [{"code": "suspected_infection", "value": 1}], at=_ago(25 * 60)).status_code == 200


class TestNeverWithdrawnNorFiled:
    def test_no_flag_is_withdrawable_or_a_manual_reading(self):
        assert not set(SLUGS) & (RETRACTABLE_CODES | MANUAL_CODES)

    @pytest.mark.parametrize("slug", SLUGS)
    def test_the_withdrawal_refuses_a_flag_and_writes_nothing(self, world, slug):
        """X22's rule, as for the suspected-infection mark: a flag is corrected by a new entry."""
        client, audit, readings = world
        r = _chart(client, [{"code": slug, "value": 1}], at=_ago(5))
        entry = r.json()["entries"][0]["entry"]
        trail = len(audit.records(tenant="h1", limit=100))
        r = client.post(f"/clinical/S-101/entries/{entry}/retract", json={"reason": "yanlış hastaya girildi"},
                        headers=NURSE)
        assert (r.status_code, r.json()["detail"]) == (409, RETRACT_NOT_BEDSIDE)
        assert len(audit.records(tenant="h1", limit=100)) == trail
        assert _filed(readings) == []


class TestTheDeviceDoor:
    @pytest.mark.parametrize("slug", SLUGS)
    def test_ingest_refuses_each_flag_before_anything_is_written(self, world, slug):
        client, audit, readings = world
        for value in (1, 0):
            r = client.post("/ingest", json=obs(slug, value, patient="S-101"), headers=DEVICE)
            assert (r.status_code, r.json()["detail"]) == (400, REFUSED)
        assert audit.records(tenant="h1", limit=100) == []                       # no `ingest` row, no frame's rows
        assert client.get("/patients", headers=DEVICE).json()["patients"] == []   # the engine never saw it
        assert _filed(readings) == []

    def test_an_unknown_number_under_the_unmatched_policy_is_refused_not_listed(self):
        audit, readings = InMemoryAuditLog(), InMemoryReadingStore()
        with TestClient(_app(audit=audit, readings=readings, unknown_readings=POLICY_UNMATCHED)) as client:
            r = client.post("/ingest", json=obs("isolation_airborne", 1, patient="S-404"), headers=DEVICE)
        assert (r.status_code, r.json()["detail"]) == (400, REFUSED)
        assert audit.records(tenant="h1", limit=100) == [] and _filed(readings) == []

    def test_a_device_cannot_move_a_flag_a_nurse_charted(self, world):
        client, _, _ = world
        assert _chart(client, [{"code": "isolation_contact", "value": 1}]).status_code == 200
        before = client.get("/patients", headers=DEVICE).json()["patients"]
        r = client.post("/ingest", json=obs("isolation_contact", 0, patient="S-101"), headers=DEVICE)
        assert r.status_code == 400
        assert client.get("/patients", headers=DEVICE).json()["patients"] == before

    def test_another_reading_still_passes(self, world):
        client, _, _ = world
        assert client.post("/ingest", json=obs("heart_rate", 88, patient="S-101"), headers=DEVICE).status_code == 200
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /c/tmp/g4-enfeksiyon/homunculus-engine && "/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest tests/test_canonical.py tests/test_isolation_chart.py -q -p no:cacheprovider`
Expected: a collection error — `ImportError: cannot import name 'ISOLATION_CODES' from 'homunculus.api.clinical'` in `tests/test_isolation_chart.py` — and pytest stops (`Interrupted: 1 error during collection`). `tests/test_canonical.py` alone: `1 failed, 2 passed` (`test_the_four_isolation_flags_are_signal_codes`).

- [ ] **Step 3: Add the four codes**

In `homunculus-engine/src/homunculus/canonical.py`, find:

```python
    SUSPECTED_INFECTION = "suspected_infection"   # 1.0 = infection suspected
    ANTIBIOTIC_ADMINISTERED = "antibiotic_administered"  # 1.0 = a dose was given
```

Replace with:

```python
    SUSPECTED_INFECTION = "suspected_infection"   # 1.0 = infection suspected
    ANTIBIOTIC_ADMINISTERED = "antibiotic_administered"  # 1.0 = a dose was given
    # G4-05 «Enfeksiyon kontrol» (spec D3, D7): the patient's isolation precautions as a clinician charts them, four
    # flags — 1.0 = the precaution is in place, 0.0 = it is not. No rule reads them; no device may send them.
    ISOLATION_CONTACT = "isolation_contact"
    ISOLATION_DROPLET = "isolation_droplet"
    ISOLATION_AIRBORNE = "isolation_airborne"
    ISOLATION_PROTECTIVE = "isolation_protective"
```

- [ ] **Step 4: Open the chart door to them, with the bedside time bound**

In `homunculus-engine/src/homunculus/api/clinical.py`, find:

```python
    SignalCode.DRAIN_OUTPUT_ML: "mL",
    SignalCode.OTHER_OUTPUT_ML: "mL",
}
```

Replace with:

```python
    SignalCode.DRAIN_OUTPUT_ML: "mL",
    SignalCode.OTHER_OUTPUT_ML: "mL",
    # G4-05 «Enfeksiyon kontrol» (spec D3, D7): the patient's isolation precautions — four flags, 1 or 0 (`_BOOLEAN`),
    # charted from the patient screen's «İzolasyon» box. Not withdrawable (they stay out of RETRACTABLE_CODES, and so
    # out of the measurement record): a flag is corrected by a new entry, as the suspected-infection mark is (X22). No
    # rule reads them, and no device sends them (`/ingest` refuses them, spec §5 M8).
    SignalCode.ISOLATION_CONTACT: "bool",
    SignalCode.ISOLATION_DROPLET: "bool",
    SignalCode.ISOLATION_AIRBORNE: "bool",
    SignalCode.ISOLATION_PROTECTIVE: "bool",
}
```

Then find:

```python
# The flags are recorded as 1.0 / 0.0; anything else is a caller error rather than a value.
_BOOLEAN = {SignalCode.SUSPECTED_INFECTION, SignalCode.ANTIBIOTIC_ADMINISTERED,
            SignalCode.SUPPLEMENTAL_OXYGEN, SignalCode.ON_RESP_SUPPORT}   # G2-A4 (D4)
```

Replace with:

```python
#: G4-05 (spec D3, D7): the four isolation flags in the one order the board's `isolation` block, GET /infection and the
#: dashboard follow — contact, droplet, airborne, protective. A flag's name on the card is its slug after `isolation_`.
ISOLATION_CODES: tuple[SignalCode, ...] = (SignalCode.ISOLATION_CONTACT, SignalCode.ISOLATION_DROPLET,
                                           SignalCode.ISOLATION_AIRBORNE, SignalCode.ISOLATION_PROTECTIVE)

# The flags are recorded as 1.0 / 0.0; anything else is a caller error rather than a value.
_BOOLEAN = {SignalCode.SUSPECTED_INFECTION, SignalCode.ANTIBIOTIC_ADMINISTERED,
            SignalCode.SUPPLEMENTAL_OXYGEN, SignalCode.ON_RESP_SUPPORT,   # G2-A4 (D4)
            *ISOLATION_CODES}                                             # G4-05 (spec D7)
```

Then find:

```python
    reading's. Raises with the clinician's sentence; all-or-nothing, as the loop above. G3-03 (D3): the time bound
    covers the fluid ledger's eight codes too — a volume is a measurement."""
    codes = {item.observation.code for item in built}
    if recorded_at is not None and codes & (BEDSIDE_VITALS | _FLUID_SIGNALS):
```

Replace with:

```python
    reading's. Raises with the clinician's sentence; all-or-nothing, as the loop above. G3-03 (D3): the time bound
    covers the fluid ledger's eight codes too — a volume is a measurement. G4-05 (spec D7): and the four isolation
    flags — a flag stamped tomorrow would stay the latest value, and no save today could end the isolation."""
    codes = {item.observation.code for item in built}
    if recorded_at is not None and codes & (BEDSIDE_VITALS | _FLUID_SIGNALS | set(ISOLATION_CODES)):
```

- [ ] **Step 5: Refuse them at the device door**

In `homunculus-engine/src/homunculus/api/app.py`, find:

```python
    RETRACT_UNKNOWN, RETRACTABLE_CODES, ClinicalEntryError, build_entries,
    chart_observations, profile_from_payload, profile_to_payload,
)
```

Replace with:

```python
    RETRACT_UNKNOWN, RETRACTABLE_CODES, ClinicalEntryError, build_entries,
    chart_observations, profile_from_payload, profile_to_payload,
    ISOLATION_CODES,                                              # G4-05: refused at /ingest (spec §5 M8)
)
```

Then find:

```python
        try:
            obs = parse_fhir_observation(resource)
        except GatewayError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
```

Replace with:

```python
        try:
            obs = parse_fhir_observation(resource)
        except GatewayError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        # G4-05 (spec §5 M8): isolation is a clinician's record. A monitor or the HIS cannot decide it, so the four flags
        # are refused right here — before the engine, the trail, the measurement record or the unmatched list hears of
        # them. An inline literal: the dashboard's apiErrors.test.js reads it from this file and holds it mapped.
        if obs.code in ISOLATION_CODES:
            raise HTTPException(status_code=400, detail="izolasyon bir klinisyen kaydıdır; cihazdan alınmaz")
```

- [ ] **Step 6: Run the tests to see them pass**

Run: `cd /c/tmp/g4-enfeksiyon/homunculus-engine && "/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest tests/test_canonical.py tests/test_isolation_chart.py tests/test_bedside_door.py tests/test_bedside_retract.py tests/test_api_clinical.py tests/test_api_ingest.py tests/test_readings_ingest.py -q -p no:cacheprovider`
Expected: `231 passed`.

- [ ] **Step 7: Commit**

```bash
cd /c/tmp/g4-enfeksiyon && git add homunculus-engine/src/homunculus/canonical.py homunculus-engine/src/homunculus/api/clinical.py homunculus-engine/src/homunculus/api/app.py homunculus-engine/tests/test_canonical.py homunculus-engine/tests/test_isolation_chart.py && git commit -m "feat(clinical): G4-05 the four isolation flags — chartable as bool (0/1/true/false) in ISOLATION_CODES order, under the bedside time bound, not withdrawable and never in the measurement record; /ingest refuses them from a device (400) before anything is written" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- homunculus-engine/src/homunculus/canonical.py homunculus-engine/src/homunculus/api/clinical.py homunculus-engine/src/homunculus/api/app.py homunculus-engine/tests/test_canonical.py homunculus-engine/tests/test_isolation_chart.py
```

---

## Task 3 (engine): the card's `isolation` block — the flags and their time, no person

**Files:**
- Modify: `homunculus-engine/src/homunculus/api/board.py` (an import; `_isolation` after `_sepsis_context`; `identity_only_board`; `patient_board`)
- Test: `homunculus-engine/tests/test_api_board_isolation.py` (new, no DB)

- [ ] **Step 1: Write the failing tests**

Create `homunculus-engine/tests/test_api_board_isolation.py` with:

```python
# homunculus-engine/tests/test_api_board_isolation.py
"""G4-05 «Enfeksiyon kontrol» (spec D8 as §5 S2 amends it): the board card's `isolation` block — each of the four
flags three-valued (null: never charted; else its latest value ≥ 1), `types` the ones in place in the one order,
`state` the server's word, `charted_at` the newest of the four latest times — and NO person: who charted it is in the
`chart` rows (/denetim). An identity-only card carries `isolation: null`. A restart restores the flags from the trail
through the existing chart replay. Synthetic patients only (CLAUDE.md rule 6)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from homunculus.api.app import create_app
from homunculus.api.audit import AuditEvent, InMemoryAuditLog
from homunculus.api.patient_identity import IdentityRecord, InMemoryIdentityStore

TOKEN = "tok"
AUTH = {"Authorization": f"Bearer {TOKEN}"}
FLAGS = ("contact", "droplet", "airborne", "protective")
UNRECORDED = {"contact": None, "droplet": None, "airborne": None, "protective": None, "types": [],
              "state": "unrecorded", "charted_at": None}


def _app(audit=None, identities=None):
    return create_app({TOKEN: "h1"}, run_escalation_loop=False,
                      audit=audit if audit is not None else InMemoryAuditLog(), identities=identities)


def _at(minutes_ago: float) -> datetime:
    return (datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)).replace(microsecond=0)


def _chart(client, flags: dict, at: datetime, pid="S-101"):
    """The flags named, in the order given, at one time — as the box saves them (it sends all four)."""
    entries = [{"code": f"isolation_{name}", "value": value} for name, value in flags.items()]
    r = client.post(f"/clinical/{pid}", json={"entries": entries, "recorded_at": at.isoformat()}, headers=AUTH)
    assert r.status_code == 200, r.text


def _card(client, pid="S-101"):
    return next(p for p in client.get("/patients", headers=AUTH).json()["patients"] if p["patient_id"] == pid)


def _admitted() -> InMemoryIdentityStore:
    """S-102 admitted (a name from the HIS) and never measured: an identity-only card."""
    identities = InMemoryIdentityStore()
    identities.apply("h1", IdentityRecord(patient_id="S-102", given="Ayşe", family="Sentetik", unit="YB", room="1",
                                          bed="2", source="comed", updated_at=datetime(2026, 11, 12, tzinfo=timezone.utc)))
    return identities


class TestTheBlock:
    def test_a_measured_patient_nobody_charted_is_unrecorded(self):
        with TestClient(_app()) as client:
            assert client.post("/clinical/S-101", json={"entries": [{"code": "weight_kg", "value": 70}]},
                               headers=AUTH).status_code == 200
            assert _card(client)["isolation"] == UNRECORDED

    def test_each_flag_is_three_valued_and_the_types_follow_the_one_order(self):
        at = _at(10)
        with TestClient(_app()) as client:
            _chart(client, {"droplet": 1, "contact": 1, "airborne": 0}, at)          # charted out of order
            assert _card(client)["isolation"] == {
                "contact": True, "droplet": True, "airborne": False, "protective": None,
                "types": ["contact", "droplet"], "state": "isolated", "charted_at": at.isoformat()}

    def test_four_zeros_are_no_isolation_on_record_not_unrecorded(self):
        at = _at(10)
        with TestClient(_app()) as client:
            _chart(client, dict.fromkeys(FLAGS, 0), at)
            block = _card(client)["isolation"]
        assert (block["state"], block["types"], block["charted_at"]) == ("not_isolated", [], at.isoformat())
        assert [block[name] for name in FLAGS] == [False] * 4

    def test_each_flag_reads_its_own_latest_value_and_charted_at_is_the_newest(self):
        first, second = _at(60), _at(5)
        with TestClient(_app()) as client:
            _chart(client, {"contact": 1, "droplet": 1, "airborne": 0, "protective": 0}, first)
            _chart(client, {"droplet": 0}, second)                                  # one flag alone, later
            block = _card(client)["isolation"]
        assert (block["contact"], block["droplet"]) == (True, False)
        assert (block["types"], block["state"], block["charted_at"]) == (["contact"], "isolated", second.isoformat())

    def test_a_backdated_flag_older_than_the_latest_does_not_move_it(self):
        latest, older = _at(5), _at(120)
        with TestClient(_app()) as client:
            _chart(client, {"airborne": 1}, latest)
            _chart(client, {"airborne": 0}, older)
            block = _card(client)["isolation"]
        assert (block["airborne"], block["state"], block["charted_at"]) == (True, "isolated", latest.isoformat())

    def test_the_block_names_nobody(self):
        """§5 S2: who charted it is the `chart` rows' (/denetim); the card carries the time only."""
        with TestClient(_app()) as client:
            _chart(client, {"contact": 1}, _at(5))
            block = _card(client)["isolation"]
        assert set(block) == {*FLAGS, "types", "state", "charted_at"}


class TestTheIdentityOnlyCard:
    def test_it_carries_null(self):
        with TestClient(_app(identities=_admitted())) as client:
            card = _card(client, "S-102")
        assert card["isolation"] is None

    def test_a_flag_charted_on_it_makes_a_card_that_still_reads_unmeasured(self):
        """Spec D7: as a suspected-infection mark today — the engine state is created, `measuredAt` stays empty."""
        with TestClient(_app(identities=_admitted())) as client:
            _chart(client, {"contact": 1}, _at(5), pid="S-102")
            card = _card(client, "S-102")
        assert card["isolation"]["state"] == "isolated" and card["identity"]["display_name"]
        assert all(at is None for at in card["latest"]["at"].values())


class TestTheTrail:
    def test_a_restart_restores_the_flags_through_the_chart_replay(self):
        audit, at = InMemoryAuditLog(), _at(15)
        with TestClient(_app(audit)) as client:
            _chart(client, {"contact": 1, "droplet": 0, "airborne": 0, "protective": 1}, at)
            before = _card(client)["isolation"]
        with TestClient(_app(audit)) as client:
            after = _card(client)["isolation"]
        assert after == before
        assert (after["types"], after["charted_at"]) == (["contact", "protective"], at.isoformat())

    def test_a_chart_row_of_a_flag_this_build_does_not_know_is_skipped(self):
        """`rehydrate.observation_of` skips an unknown slug (as an older api skips these four): the rest replays."""
        audit, at = InMemoryAuditLog(), _at(30)
        for subject in ("isolation_quarantine", "isolation_contact"):
            audit.append(AuditEvent("h1", "chart", "S-101", subject, {
                "value": 1.0, "unit": "bool", "obs_ts": at.isoformat(), "charted_by": "hem.ayse"}))
        with TestClient(_app(audit)) as client:
            block = _card(client)["isolation"]
        assert (block["types"], block["charted_at"]) == (["contact"], at.isoformat())
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /c/tmp/g4-enfeksiyon/homunculus-engine && "/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest tests/test_api_board_isolation.py -q -p no:cacheprovider`
Expected: `10 failed`, each a `KeyError: 'isolation'` (the card has no block yet).

- [ ] **Step 3: Build the block**

In `homunculus-engine/src/homunculus/api/board.py`, find:

```python
from homunculus.api.ackstore import AckStore
from homunculus.api.patient_identity import IdentityRecord, IdentityStore, is_tombstone
```

Replace with:

```python
from homunculus.api.ackstore import AckStore
from homunculus.api.clinical import ISOLATION_CODES          # G4-05
from homunculus.api.patient_identity import IdentityRecord, IdentityStore, is_tombstone
```

Then find:

```python
        "baseline_assumed": baseline is None,
        "rise": sofa - (baseline or 0),
    }
```

Replace with:

```python
        "baseline_assumed": baseline is None,
        "rise": sofa - (baseline or 0),
    }


def _isolation(state) -> dict:
    """G4-05 «Enfeksiyon kontrol» (spec D8, §5 S2): the patient's isolation as charted. Each of the four flags is
    three-valued — None: never charted; else whether its latest value is ≥ 1 — `types` are the ones in place, in
    ISOLATION_CODES' order, and `state` is the server's word: `isolated` (a type is in place), `not_isolated` (a flag was
    charted and none is in place), `unrecorded` (none was ever charted). `charted_at` is the newest of the four latest
    observations' times (a save stamps all four alike), or None. Who charted it is the `chart` rows' (/denetim): the
    card names nobody (S2). «Unrecorded» is not «not isolated»: nobody recorded anything in this system."""
    flags: dict[str, bool | None] = {}
    times: list[datetime] = []
    for code in ISOLATION_CODES:
        obs = state.latest(code)
        flags[code.value.removeprefix("isolation_")] = None if obs is None else obs.value >= 1.0
        if obs is not None:
            times.append(obs.timestamp)
    types = [name for name, on in flags.items() if on]
    word = "isolated" if types else "not_isolated" if times else "unrecorded"
    return {**flags, "types": types, "state": word, "charted_at": _iso(max(times)) if times else None}
```

Then find:

```python
        "identity": {**record.as_board(), **_bed_resolution(record, bedmap)},
    }
```

Replace with:

```python
        "identity": {**record.as_board(), **_bed_resolution(record, bedmap)},
        # G4-05 (spec D8): no engine state, so no isolation charted — null, which every reader takes as «unrecorded».
        "isolation": None,
    }
```

Then find:

```python
        # Infusions, the antibiotic clock, and the two numbers a pharmacist reads them against.
        "meds": _meds(engine, state, patient_id, now),
```

Replace with:

```python
        # Infusions, the antibiotic clock, and the two numbers a pharmacist reads them against.
        "meds": _meds(engine, state, patient_id, now),
        # G4-05 (spec D8): the isolation precautions a clinician charted — the flags and their time, no person.
        "isolation": _isolation(state),
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd /c/tmp/g4-enfeksiyon/homunculus-engine && "/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest tests/test_api_board_isolation.py tests/test_board.py tests/test_api_board_identity.py tests/test_api_board_sepsis.py tests/test_api_board_meds.py tests/test_api_board_bedmap.py tests/test_api_board_shadow.py tests/test_kabul_boardlink.py tests/test_pharmacy.py tests/test_pharmacy_api.py -q -p no:cacheprovider`
Expected: `176 passed`.

- [ ] **Step 5: Commit**

```bash
cd /c/tmp/g4-enfeksiyon && git add homunculus-engine/src/homunculus/api/board.py homunculus-engine/tests/test_api_board_isolation.py && git commit -m "feat(board): G4-05 the card's isolation block — four three-valued flags, types in ISOLATION_CODES order, the server's state word and charted_at, no person (spec §5 S2); an identity-only card carries null; the chart replay restores it" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- homunculus-engine/src/homunculus/api/board.py homunculus-engine/tests/test_api_board_isolation.py
```

---

## Task 4 (engine): `GET /infection` — the pure builder and the route

**Files:**
- Create: `homunculus-engine/src/homunculus/api/infection.py`
- Modify: `homunculus-engine/src/homunculus/api/app.py` (the key constant after `PHARMACY_VIEW`; the import after `ward_pharmacy`'s; the route after `/pharmacy`)
- Test: `homunculus-engine/tests/test_infection.py` (new, pure, no DB)
- Test: `homunculus-engine/tests/test_infection_api.py` (new, no DB)

- [ ] **Step 1: Write the failing builder tests**

Create `homunculus-engine/tests/test_infection.py` with:

```python
# homunculus-engine/tests/test_infection.py
"""G4-05 «Enfeksiyon kontrol» (spec D10 as §5 S1, S2, A3, M3, M4 amend it): `ward_infection`, pure. The rows of the
two lists (a patient in both), each with Eczane's antibiotic object for its card, the three Sepsis-3 rule kinds firing
and latched (listed, not counted), `sort_group`; the bed occupants; the counts whole and per unit, the two «unrecorded»
counts among them; an identity-only card read defensively; no card → the whole shape. The cards are built here in the
board's shape (api/board.py); synthetic keys and names only (CLAUDE.md rule 6)."""
from __future__ import annotations

from datetime import datetime, timezone

from homunculus.api.infection import SEPSIS_KINDS, ward_infection
from homunculus.api.pharmacy import antibiotic_of

NOW = datetime(2026, 11, 12, 9, 30, tzinfo=timezone.utc)
KEYS = ["now", "antibiotic_window_min", "antibiotic_window_source", "counts", "units", "isolated", "suspected",
        "bed_occupants"]
COUNT_KEYS = ["patients", "isolated", "isolation_unrecorded", "suspected", "suspected_unrecorded", "clock_missed",
              "sepsis_open"]
ZERO = dict.fromkeys(COUNT_KEYS, 0)


def iso(*types, state=None, at="2026-11-12T08:10:00+00:00"):
    """A card's `isolation` block (api/board.py `_isolation`) with these types in place; `state` overrides."""
    flags = {name: (name in types) for name in ("contact", "droplet", "airborne", "protective")}
    return {**flags, "types": list(types), "state": state or ("isolated" if types else "not_isolated"),
            "charted_at": at}


UNRECORDED_BLOCK = {"contact": None, "droplet": None, "airborne": None, "protective": None, "types": [],
                    "state": "unrecorded", "charted_at": None}


def alert(kind, severity="high", *, resolved_at=None, acknowledged=False, snooze=None):
    return {"kind": kind, "severity": severity, "first_seen_at": "2026-11-12T08:20:00+00:00", "resolved_at": resolved_at,
            "acknowledged": acknowledged, "snooze": snooze, "summary": "x"}


def clock(remaining_sec, **over):
    """A `meds` block whose antibiotic clock is open (no administration), `remaining_sec` from the deadline."""
    return {"antibiotic_given": None, "antibiotic_at": None, **over,
            "antibiotic_clock": {"recognized_at": "2026-11-12T08:05:00+00:00", "deadline": "2026-11-12T09:05:00+00:00",
                                 "remaining_sec": remaining_sec, "elapsed_sec": 0, "met": None}}


def card(pid, *, bed="", bed_id=None, unit=None, name="", isolation=UNRECORDED_BLOCK, suspected=None, meds=None,
         alerts=()):
    """A measured card in the board's shape — only what the builder reads."""
    return {"patient_id": pid,
            "identity": {"bed_label": bed, "bed_id": bed_id, "unit_id": unit, "display_name": name},
            "isolation": isolation, "alerts": list(alerts), "meds": meds,
            "sepsis": {"suspected_infection": suspected, "sofa": 2, "baseline_sofa": None, "baseline_assumed": True,
                       "rise": 2}}


def identity_only(pid, *, bed_id=None, unit=None):
    """api/board.py `identity_only_board`: no `sepsis`, no `meds`, `isolation: null`."""
    return {"patient_id": pid, "risk": "none", "alerts": [], "latest": {}, "isolation": None,
            "identity": {"bed_label": "", "bed_id": bed_id, "unit_id": unit, "display_name": ""}}


def ids(rows):
    return [row["patient_id"] for row in rows]


class TestTheShape:
    def test_no_card_is_the_whole_shape(self):
        answer = ward_infection([], now=NOW)
        assert list(answer) == KEYS
        assert answer["now"] == "2026-11-12T09:30:00+00:00"
        assert (answer["antibiotic_window_min"], answer["antibiotic_window_source"]) == (
            60, "surviving-sepsis-campaign-2026")
        assert answer["counts"] == ZERO and list(answer["counts"]) == COUNT_KEYS
        assert answer["units"] == answer["isolated"] == answer["suspected"] == answer["bed_occupants"] == []

    def test_the_structures_part_is_the_pages_own(self):
        """§5 S1: the isolation beds come from the structure tree on the page, so the answer carries no `beds`, no
        `isolation_beds`, no unit names and no `in_isolation_room`."""
        answer = ward_infection([card("S-101", bed_id="b9", unit="u1", isolation=iso("contact"))], now=NOW)
        (row,) = answer["isolated"]
        assert "beds" not in answer and "isolation_beds" not in answer["counts"]
        assert answer["units"] == [{"unit_id": "u1", "counts": answer["counts"]}]
        assert "in_isolation_room" not in row and "charted_by" not in row["isolation"]


class TestTheRows:
    def test_a_row_is_one_card_with_eczanes_antibiotic_object(self):
        meds = clock(-1500)
        c = card("S-103", bed="YBU 1-3", bed_id="b3", unit="u1", name="Ali Sentetik", suspected=True, meds=meds,
                 alerts=[alert("septic_shock", "critical")])
        (row,) = ward_infection([c], now=NOW)["suspected"]
        assert row == {
            "patient_id": "S-103", "bed_label": "YBU 1-3", "bed_id": "b3", "unit_id": "u1", "display_name": "Ali Sentetik",
            "isolation": {"state": "unrecorded", "types": [], "charted_at": None},
            "suspected_infection": True,
            "antibiotic": antibiotic_of(meds),
            "sepsis_alarms": [{"kind": "septic_shock", "severity": "critical", "first_seen_at": "2026-11-12T08:20:00+00:00",
                               "resolved_at": None, "acknowledged": False, "snooze_until": None}],
            "sort_group": 0}
        assert row["antibiotic"]["state"] == "missed" and row["antibiotic"]["remaining_sec"] == -1500

    def test_a_patient_isolated_and_suspected_is_in_both_lists(self):
        c = card("S-101", bed="İzo 1", bed_id="b9", unit="u1", name="Ayşe Sentetik", isolation=iso("contact", "droplet"),
                 suspected=True)
        answer = ward_infection([c], now=NOW)
        assert ids(answer["isolated"]) == ids(answer["suspected"]) == ["S-101"]
        assert answer["isolated"][0]["isolation"] == {"state": "isolated", "types": ["contact", "droplet"],
                                                       "charted_at": "2026-11-12T08:10:00+00:00"}

    def test_isolated_holds_only_the_cards_in_isolation(self):
        cards = [card("S-101", isolation=iso("airborne")), card("S-102", isolation=iso()),
                 card("S-103"), identity_only("S-104")]
        assert ids(ward_infection(cards, now=NOW)["isolated"]) == ["S-101"]

    def test_suspected_holds_a_charted_mark_or_an_alarm_of_the_three_kinds(self):
        """§5 M3: a latched septic shock stays on the page after suspected infection was charted 0."""
        cards = [card("S-101", suspected=True), card("S-102", suspected=False),
                 card("S-103", suspected=False, alerts=[alert("septic_shock", "critical", resolved_at="2026-11-12T09:00:00+00:00")]),
                 card("S-104", suspected=None, alerts=[alert("sepsis_watch", "moderate"), alert("antibiotic_overdue", "critical")]),
                 card("S-105", suspected=None, alerts=[alert("under_resuscitated_sepsis")])]
        answer = ward_infection(cards, now=NOW)
        assert ids(answer["suspected"]) == ["S-101", "S-103", "S-105"]
        assert answer["counts"]["suspected"] == 1                     # the mark charted true, only
        assert answer["counts"]["sepsis_open"] == 1                   # S-105's firing alarm; S-103's is latched

    def test_the_alarms_are_the_three_kinds_in_their_order_firing_and_latched(self):
        c = card("S-101", suspected=True, alerts=[
            alert("news2", "high"), alert("under_resuscitated_sepsis", "high"), alert("antibiotic_due", "high"),
            alert("sepsis", "high", acknowledged=True),
            alert("septic_shock", "critical", resolved_at="2026-11-12T09:00:00+00:00"),
            alert("sepsis_watch", "moderate")])
        (row,) = ward_infection([c], now=NOW)["suspected"]
        assert [(a["kind"], a["resolved_at"], a["acknowledged"]) for a in row["sepsis_alarms"]] == [
            ("septic_shock", "2026-11-12T09:00:00+00:00", False), ("sepsis", None, True),
            ("under_resuscitated_sepsis", None, False)]
        assert SEPSIS_KINDS == ("septic_shock", "sepsis", "under_resuscitated_sepsis")

    def test_an_acknowledged_and_a_snoozed_firing_alarm_both_count(self):
        snooze = {"by": "hem.ayse", "at": "2026-11-12T09:00:00+00:00", "until": "2026-11-12T09:15:00+00:00",
                  "minutes": 15, "reason": "PATIENT_BASELINE", "reason_text": None}
        cards = [card("S-101", alerts=[alert("sepsis", acknowledged=True)]),
                 card("S-102", alerts=[alert("under_resuscitated_sepsis", snooze=snooze)])]
        answer = ward_infection(cards, now=NOW)
        assert answer["counts"]["sepsis_open"] == 2
        assert [a["snooze_until"] for row in answer["suspected"] for a in row["sepsis_alarms"]] == [
            None, "2026-11-12T09:15:00+00:00"]

    def test_sort_group_is_an_open_clock_then_a_firing_alarm_then_the_rest(self):
        given = {"antibiotic_given": True, "antibiotic_at": "2026-11-12T08:30:00+00:00", "antibiotic_clock": None}
        cards = [card("S-101", suspected=True, meds=clock(1200)),                                    # running
                 card("S-102", suspected=True, meds=clock(-60), alerts=[alert("sepsis")]),            # missed
                 card("S-103", suspected=True, meds=given, alerts=[alert("sepsis")]),                 # firing alarm
                 card("S-104", suspected=True, alerts=[alert("septic_shock", "critical",
                                                             resolved_at="2026-11-12T09:00:00+00:00")]),   # latched
                 card("S-105", suspected=True)]
        groups = {row["patient_id"]: row["sort_group"] for row in ward_infection(cards, now=NOW)["suspected"]}
        assert groups == {"S-101": 0, "S-102": 0, "S-103": 1, "S-104": 2, "S-105": 2}

    def test_the_lists_come_by_patient_key_the_page_orders_them(self):
        """§5 M4: the order by unit and bed NAME is the page's; the server sends its lists by key."""
        cards = [card(pid, isolation=iso("contact")) for pid in ("S-103", "S-101", "S-102")]
        assert ids(ward_infection(cards, now=NOW)["isolated"]) == ["S-101", "S-102", "S-103"]


class TestTheIdentityOnlyCard:
    def test_it_is_read_defensively_through_every_count(self):
        """§5 M4: no `sepsis`, no `meds`, `isolation: null` — suspected null, antibiotic `none`, no alarm, unrecorded."""
        answer = ward_infection([identity_only("S-104", bed_id="b4", unit="u1")], now=NOW)
        assert answer["counts"] == {**ZERO, "patients": 1, "isolation_unrecorded": 1, "suspected_unrecorded": 1}
        assert answer["isolated"] == answer["suspected"] == []
        assert answer["bed_occupants"] == [{"bed_id": "b4", "patient_id": "S-104", "display_name": "",
                                            "isolation": {"state": "unrecorded", "types": []}}]


class TestTheOccupantsAndTheCounts:
    def test_one_occupant_per_card_with_a_bed_none_for_a_card_without(self):
        cards = [card("S-101", bed_id="b9", unit="u1", name="Ayşe Sentetik", isolation=iso("contact", "droplet")),
                 card("S-102", bed_id="b9", unit="u1", isolation=iso()),
                 card("S-103", unit="u1")]
        assert ward_infection(cards, now=NOW)["bed_occupants"] == [
            {"bed_id": "b9", "patient_id": "S-101", "display_name": "Ayşe Sentetik",
             "isolation": {"state": "isolated", "types": ["contact", "droplet"]}},
            {"bed_id": "b9", "patient_id": "S-102", "display_name": "", "isolation": {"state": "not_isolated", "types": []}}]

    def test_the_counts_whole_and_per_unit_and_a_row_on_no_unit_only_in_the_whole(self):
        cards = [card("S-101", unit="u1", isolation=iso("contact"), suspected=True),
                 card("S-102", unit="u1", isolation=iso(), suspected=False, meds=clock(-30)),
                 card("S-103", unit="u2", alerts=[alert("sepsis")]),
                 card("S-104", isolation=iso("airborne"), suspected=None),                       # on no unit
                 identity_only("S-105", unit="u2")]
        answer = ward_infection(cards, now=NOW)
        assert answer["counts"] == {"patients": 5, "isolated": 2, "isolation_unrecorded": 2, "suspected": 1,
                                    "suspected_unrecorded": 3, "clock_missed": 1, "sepsis_open": 1}
        assert answer["units"] == [
            {"unit_id": "u1", "counts": {"patients": 2, "isolated": 1, "isolation_unrecorded": 0, "suspected": 1,
                                         "suspected_unrecorded": 0, "clock_missed": 1, "sepsis_open": 0}},
            {"unit_id": "u2", "counts": {"patients": 2, "isolated": 0, "isolation_unrecorded": 2, "suspected": 0,
                                         "suspected_unrecorded": 2, "clock_missed": 0, "sepsis_open": 1}}]

    def test_a_not_isolated_card_is_not_counted_as_unrecorded(self):
        answer = ward_infection([card("S-101", isolation=iso()), card("S-102")], now=NOW)
        assert (answer["counts"]["isolated"], answer["counts"]["isolation_unrecorded"]) == (0, 1)
```

- [ ] **Step 2: Write the failing API tests**

Create `homunculus-engine/tests/test_infection_api.py` with:

```python
# homunculus-engine/tests/test_infection_api.py
"""G4-05 «Enfeksiyon kontrol» (spec D4, D10, D12 as §5 amends them): GET /infection against the DB-less app — the right
that opens it (and the device token, as on every board route), the caller's scoped cards with `/patients`' own scope
block, a flag saved through the chart door and then ended, a sepsis alarm and its clock, an identity-only card, an
unreadable scope, a discharged patient, two hospitals, and a read that writes nothing. Synthetic ward only (as
tests/test_pharmacy_api.py: `p-a1`…, units `unit-adult` / `unit-nicu`)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from homunculus.api.app import create_app
from homunculus.api.identity import Caller
from homunculus.api.patient_identity import IdentityRecord, InMemoryIdentityStore
from homunculus.scope import Scope, build_scope
from homunculus.scope.resolver import UNKNOWN
from homunculus.tenant.bedmap import BedMap

DEVICE = {"Authorization": "Bearer bridge-token"}
NURSE = {"Authorization": "Bearer nurse-jwt"}
KEY_ONLY = {"Authorization": "Bearer key-only-jwt"}
PHARMACIST = {"Authorization": "Bearer pharmacist-jwt"}
PEOPLE = {
    "nurse-jwt": Caller(hospital="demo", actor="hem.ayse", groups=("nurse",),
                        perms=frozenset({"board.view", "clinical.chart", "infection.view"})),
    "key-only-jwt": Caller(hospital="demo", actor="hem.leyla", groups=("synth",), perms=frozenset({"infection.view"})),
    "pharmacist-jwt": Caller(hospital="demo", actor="ecz.murad", groups=("pharmacist",),
                             perms=frozenset({"board.view", "pharmacy.view"})),
}
ADULT = build_scope("NURSE", unit_ids=["unit-adult"])
WHOLE = build_scope("HOSPITAL_ADMIN")
BEDMAP = BedMap.from_dict({"beds": {
    "YB^304^1": {"bed_id": "bed-a1", "unit_id": "unit-adult"},
    "YB^304^2": {"bed_id": "bed-a2", "unit_id": "unit-adult"},
    "YYB^12^A": {"bed_id": "bed-n1", "unit_id": "unit-nicu"},
}})
KEYS = ["now", "antibiotic_window_min", "antibiotic_window_source", "counts", "units", "isolated", "suspected",
        "bed_occupants", "scope", "scope_note"]
FLAGS = ("contact", "droplet", "airborne", "protective")


def _identities() -> InMemoryIdentityStore:
    store = InMemoryIdentityStore()
    for pid, given, unit, room, bed in (("p-a1", "Bir", "YB", "304", "1"), ("p-a2", "İki", "YB", "304", "2"),
                                        ("p-n1", "Üç", "YYB", "12", "A")):
        store.apply("demo", IdentityRecord(patient_id=pid, given="Örnek Hasta", family=given, unit=unit, room=room,
                                           bed=bed, source="comed",
                                           updated_at=datetime(2026, 11, 4, tzinfo=timezone.utc)))
    return store


def _app(scope: Scope = WHOLE, *, identities=None):
    async def resolve_scope(_credential: str) -> Scope:
        return scope

    async def resolve_jwt(credential: str):
        return PEOPLE.get(credential)

    return create_app({"bridge-token": "demo"}, run_escalation_loop=False,
                      identities=identities if identities is not None else _identities(), bedmap=BEDMAP,
                      resolve_jwt=resolve_jwt, resolve_scope=resolve_scope)


def _chart(client, pid, entries, at=None, headers=NURSE):
    body = {"entries": entries}
    if at is not None:
        body["recorded_at"] = at.isoformat()
    r = client.post(f"/clinical/{pid}", json=body, headers=headers)
    assert r.status_code == 200, r.text


def _isolate(client, pid, *types, headers=NURSE):
    """The box's save: all four flags, no time (the server's instant is the record's)."""
    _chart(client, pid, [{"code": f"isolation_{name}", "value": int(name in types)} for name in FLAGS], headers=headers)


def _raise_sepsis(client, pid, at, headers=DEVICE):
    """Suspected infection with a SOFA rise: the engine's sepsis rule fires, and recognition is stamped `at`."""
    _chart(client, pid, [{"code": "suspected_infection", "value": 1}, {"code": "platelets", "value": 80},
                         {"code": "creatinine", "value": 3.5}], at, headers)


def _infection(client, headers=NURSE):
    return client.get("/infection", headers=headers)


def _ids(rows):
    return [row["patient_id"] for row in rows]


@pytest.fixture()
def ward():
    app = _app()
    with TestClient(app) as client:
        yield app, client


class TestTheRight:
    def test_it_needs_infection_view_and_the_key_alone_opens_it(self, ward):
        _app_, client = ward
        assert client.get("/infection").status_code == 401
        refused = _infection(client, PHARMACIST)
        assert (refused.status_code, refused.json()["detail"]) == (403, "permission required: infection.view")
        assert _infection(client, KEY_ONLY).status_code == 200          # without board.view
        assert _infection(client).status_code == 200

    def test_the_device_token_passes_as_on_every_board_route(self, ward):
        _app_, client = ward
        r = _infection(client, DEVICE)
        assert r.status_code == 200 and r.json()["scope"]["unrestricted"] is True


class TestTheAnswer:
    def test_the_keys_the_window_and_its_source(self, ward):
        _app_, client = ward
        before = datetime.now(timezone.utc)
        answer = _infection(client).json()
        after = datetime.now(timezone.utc)
        assert list(answer) == KEYS
        assert (answer["antibiotic_window_min"], answer["antibiotic_window_source"]) == (
            60, "surviving-sepsis-campaign-2026")
        assert answer["now"].endswith("+00:00") and before <= datetime.fromisoformat(answer["now"]) <= after

    def test_identity_only_cards_are_counted_unrecorded_and_listed_nowhere_but_their_beds(self, ward):
        _app_, client = ward
        answer = _infection(client).json()
        assert answer["counts"] == {"patients": 3, "isolated": 0, "isolation_unrecorded": 3, "suspected": 0,
                                    "suspected_unrecorded": 3, "clock_missed": 0, "sepsis_open": 0}
        assert answer["isolated"] == answer["suspected"] == []
        assert answer["bed_occupants"] == [
            {"bed_id": "bed-a1", "patient_id": "p-a1", "display_name": "Örnek Hasta Bir",
             "isolation": {"state": "unrecorded", "types": []}},
            {"bed_id": "bed-a2", "patient_id": "p-a2", "display_name": "Örnek Hasta İki",
             "isolation": {"state": "unrecorded", "types": []}},
            {"bed_id": "bed-n1", "patient_id": "p-n1", "display_name": "Örnek Hasta Üç",
             "isolation": {"state": "unrecorded", "types": []}}]
        assert [u["unit_id"] for u in answer["units"]] == ["unit-adult", "unit-nicu"]

    def test_a_save_through_the_chart_door_lists_the_patient_and_four_zeros_end_it(self, ward):
        _app_, client = ward
        before = datetime.now(timezone.utc)
        _isolate(client, "p-a1", "contact", "droplet")
        answer = _infection(client).json()
        (row,) = answer["isolated"]
        assert (row["patient_id"], row["bed_label"], row["bed_id"], row["unit_id"], row["display_name"]) == (
            "p-a1", "YB 304-1", "bed-a1", "unit-adult", "Örnek Hasta Bir")
        assert (row["isolation"]["state"], row["isolation"]["types"]) == ("isolated", ["contact", "droplet"])
        assert before <= datetime.fromisoformat(row["isolation"]["charted_at"]) <= datetime.now(timezone.utc)
        assert set(row["isolation"]) == {"state", "types", "charted_at"}               # no person (§5 S2)
        assert (answer["counts"]["isolated"], answer["counts"]["isolation_unrecorded"]) == (1, 2)
        _isolate(client, "p-a1")                                                      # all four to 0
        answer = _infection(client).json()
        assert answer["isolated"] == []
        assert (answer["counts"]["isolated"], answer["counts"]["isolation_unrecorded"]) == (0, 2)
        (occupant,) = [o for o in answer["bed_occupants"] if o["patient_id"] == "p-a1"]
        assert occupant["isolation"] == {"state": "not_isolated", "types": []}

    def test_a_sepsis_alarm_and_its_clock(self, ward):
        _app_, client = ward
        now = datetime.now(timezone.utc).replace(microsecond=0)
        _raise_sepsis(client, "p-n1", now - timedelta(hours=3))                 # the window closed two hours ago
        answer = _infection(client).json()
        (row,) = answer["suspected"]
        assert (row["patient_id"], row["suspected_infection"], row["sort_group"]) == ("p-n1", True, 0)
        assert row["antibiotic"]["state"] == "missed"
        (eczane,) = [r for r in client.get("/pharmacy", headers=DEVICE).json()["rows"] if r["patient_id"] == "p-n1"]
        # Eczane's object for the same card; `remaining_sec` is counted at each read's own instant, a moment apart.
        assert {**row["antibiotic"], "remaining_sec": 0} == {**eczane["antibiotic"], "remaining_sec": 0}
        assert [(a["kind"], a["resolved_at"]) for a in row["sepsis_alarms"]] == [("sepsis", None)]
        assert answer["counts"] == {"patients": 3, "isolated": 0, "isolation_unrecorded": 3, "suspected": 1,
                                    "suspected_unrecorded": 2, "clock_missed": 1, "sepsis_open": 1}
        (nicu,) = [u for u in answer["units"] if u["unit_id"] == "unit-nicu"]
        assert (nicu["counts"]["suspected"], nicu["counts"]["sepsis_open"]) == (1, 1)


class TestTheScope:
    def test_only_the_callers_beds_with_patients_own_scope_block(self):
        with TestClient(_app(ADULT)) as client:
            _isolate(client, "p-n1", "airborne", headers=DEVICE)
            _isolate(client, "p-a2", "protective", headers=DEVICE)
            answer = _infection(client).json()
            board = client.get("/patients", headers=NURSE).json()
            everything = _infection(client, DEVICE).json()
        assert _ids(answer["isolated"]) == ["p-a2"]                                  # the NICU's patient is not hers
        assert [o["patient_id"] for o in answer["bed_occupants"]] == ["p-a1", "p-a2"]
        assert [u["unit_id"] for u in answer["units"]] == ["unit-adult"]
        assert answer["counts"]["patients"] == 2
        assert (answer["scope"], answer["scope_note"]) == (board["scope"], board["scope_note"])
        assert answer["scope"]["unit_ids"] == ["unit-adult"] and answer["scope"]["hidden"] == 1
        assert _ids(everything["isolated"]) == ["p-a2", "p-n1"]

    def test_a_scope_that_reaches_no_card_answers_the_whole_shape_and_says_why(self):
        with TestClient(_app(build_scope("NURSE", unit_ids=["unit-yok"]))) as client:
            answer = _infection(client).json()
        assert list(answer) == KEYS and answer["counts"]["patients"] == 0
        assert answer["units"] == answer["isolated"] == answer["suspected"] == answer["bed_occupants"] == []
        assert answer["scope"]["blind"] is True and answer["scope_note"]

    def test_an_unreadable_scope_is_503_not_an_empty_list(self):
        with TestClient(_app(UNKNOWN)) as client:
            r = _infection(client)
        assert (r.status_code, r.json()["detail"]) == (503, "kapsam şu anda okunamıyor")

    def test_a_patient_discharged_through_kabul_is_absent_as_on_the_board(self):
        identities = _identities()
        with TestClient(_app(identities=identities)) as client:
            _isolate(client, "p-a1", "contact")
            assert _ids(_infection(client).json()["isolated"]) == ["p-a1"]
            identities.apply("demo", IdentityRecord(patient_id="p-a1", given="Örnek Hasta", family="Bir",
                                                    state="discharged", source="kabul",
                                                    updated_at=datetime.now(timezone.utc)))
            answer = _infection(client).json()
        assert answer["isolated"] == [] and "p-a1" not in [o["patient_id"] for o in answer["bed_occupants"]]
        assert answer["counts"]["patients"] == 2


class TestTheTrail:
    def test_the_read_appends_nothing_to_the_audit_log(self, ward):
        app, client = ward
        _isolate(client, "p-a1", "contact")
        before = len(app.state.audit.records(tenant="demo", limit=10_000))
        for headers in (NURSE, KEY_ONLY, DEVICE):
            assert _infection(client, headers).status_code == 200
        assert _infection(client, PHARMACIST).status_code == 403
        assert len(app.state.audit.records(tenant="demo", limit=10_000)) == before


class TestTwoHospitals:
    def test_each_hospital_reads_only_its_own_rows_and_counts(self):
        """Two hospitals whose patients share the patient key AND the bed label: a caller of one sees its own row,
        flags and counts — nothing of the other's, not a name, a flag or an alarm."""
        other = {"Authorization": "Bearer other-jwt"}
        other_device = {"Authorization": "Bearer bridge-other"}
        people = {**PEOPLE, "other-jwt": Caller(hospital="diger", actor="hem.nigar", groups=("nurse",),
                                                perms=frozenset({"board.view", "infection.view"}))}
        identities = _identities()
        identities.apply("diger", IdentityRecord(patient_id="p-a1", given="Örnek Hasta", family="Dört", unit="YB",
                                                 room="304", bed="1", source="comed",
                                                 updated_at=datetime(2026, 11, 4, tzinfo=timezone.utc)))

        async def resolve_scope(_credential: str) -> Scope:
            return WHOLE

        async def resolve_jwt(credential: str):
            return people.get(credential)

        app = create_app({"bridge-token": "demo", "bridge-other": "diger"}, run_escalation_loop=False,
                         identities=identities, bedmap=BEDMAP, resolve_jwt=resolve_jwt, resolve_scope=resolve_scope)
        with TestClient(app) as client:
            _isolate(client, "p-a1", "contact", headers=DEVICE)
            _raise_sepsis(client, "p-a1", datetime.now(timezone.utc) - timedelta(hours=3), other_device)
            here, there = _infection(client).json(), _infection(client, other).json()
        (mine,) = here["isolated"]
        assert (mine["display_name"], mine["isolation"]["types"], mine["suspected_infection"]) == (
            "Örnek Hasta Bir", ["contact"], None)
        assert here["suspected"] == [] and here["counts"]["sepsis_open"] == 0
        (theirs,) = there["suspected"]
        assert (theirs["patient_id"], theirs["bed_label"], theirs["display_name"]) == ("p-a1", "YB 304-1",
                                                                                       "Örnek Hasta Dört")
        assert theirs["isolation"]["state"] == "unrecorded" and there["isolated"] == []
        assert there["counts"] == {"patients": 1, "isolated": 0, "isolation_unrecorded": 1, "suspected": 1,
                                   "suspected_unrecorded": 0, "clock_missed": 1, "sepsis_open": 1}
```

- [ ] **Step 3: Run them to see them fail**

Run: `cd /c/tmp/g4-enfeksiyon/homunculus-engine && "/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest tests/test_infection.py tests/test_infection_api.py -q -p no:cacheprovider`
Expected: a collection error — `ModuleNotFoundError: No module named 'homunculus.api.infection'` in `tests/test_infection.py` — and pytest stops (`Interrupted: 1 error during collection`). `tests/test_infection_api.py` alone: `12 failed` (no route yet).

- [ ] **Step 4: Write the builder**

Create `homunculus-engine/src/homunculus/api/infection.py` with:

```python
# homunculus-engine/src/homunculus/api/infection.py
"""Enfeksiyon kontrol (G4-05): the infection-control page's answer, built by the server from the caller's scoped
board cards (spec D4, D10, as §5 S1, S2, A3, M3, M4 amend them). Pure: no route, no engine, no database.

A row is one scoped card: its bed and name (as Eczane's `row_of` reads them), its isolation as the card's `isolation`
block charted it (api/board.py `_isolation`, without the four raw flags), its three-valued suspected-infection mark,
its antibiotic state — `pharmacy.antibiotic_of(card["meds"])`, the very object GET /pharmacy answers for that card,
reused and not copied — and its alarms of the engine's three Sepsis-3 rule kinds, firing and latched, each with
whether it was acknowledged and until when it is snoozed. `isolated` lists the cards in isolation; `suspected` the
cards with suspected infection charted, or with an alarm of the three kinds (§5 M3: a latched one stays listed after
the mark was charted 0). `bed_occupants` says who lies on each bed the scoped cards hold, so the page can word the
isolation beds it draws from the structure tree (§5 S1). The counts are the server's. The ORDER of the lists is the
page's — by the unit and bed names it holds (§5 M4) — and the server sends them by patient key, with `sort_group`, the
one ordering field it decides: 0 an open antibiotic clock, 1 a firing alarm of the three kinds, 2 the rest.

Nothing here judges: no isolation is recommended, no type chosen, no threshold set, no rate computed. The one sourced
number is the 1-hour antibiotic window, `rules/antibiotic_clock.py`'s, as Eczane states it. Homunculus does not
diagnose."""
from __future__ import annotations

from datetime import datetime, timezone

from homunculus.api.pharmacy import ANTIBIOTIC_WINDOW_SOURCE, CLOCK_OPEN, antibiotic_of
from homunculus.rules.antibiotic_clock import WINDOW as ANTIBIOTIC_WINDOW

#: The engine's three Sepsis-3 rule kinds (rules/septic_shock.py), in the order a row lists them. Not `antibiotic_due`
#: / `antibiotic_overdue` (the antibiotic cell says it) and not the model's `sepsis_watch` (an early warning with its
#: own source, not one of the three rule kinds).
SEPSIS_KINDS = ("septic_shock", "sepsis", "under_resuscitated_sepsis")
#: The card's three isolation words (api/board.py `_isolation`).
ISOLATED, NOT_ISOLATED, UNRECORDED = "isolated", "not_isolated", "unrecorded"


def _iso(at: datetime) -> str:
    return at.astimezone(timezone.utc).isoformat()


def isolation_of(card: dict) -> dict:
    """The card's isolation as a row carries it: `{state, types, charted_at}`. An identity-only card's block is null,
    and a card with no block at all is read the same: `unrecorded` (§5 M4)."""
    block = card.get("isolation")
    if not isinstance(block, dict):
        return {"state": UNRECORDED, "types": [], "charted_at": None}
    return {"state": block.get("state") or UNRECORDED, "types": list(block.get("types") or []),
            "charted_at": block.get("charted_at")}


def suspected_of(card: dict) -> bool | None:
    """The three-valued suspected-infection mark; None for a card with no `sepsis` block (an identity-only card)."""
    sepsis = card.get("sepsis")
    return sepsis.get("suspected_infection") if isinstance(sepsis, dict) else None


def sepsis_alarms_of(card: dict) -> list[dict]:
    """The card's alarms of the three kinds, in SEPSIS_KINDS' order: a firing one (`resolved_at` null) and a latched one
    (a critical whose rule stopped while nobody acknowledged it; the board lists a kind once), each with whether it was
    acknowledged and the end of its snooze (§5 M3)."""
    alerts = [a for a in card.get("alerts") or [] if isinstance(a, dict) and a.get("kind") in SEPSIS_KINDS]
    alerts.sort(key=lambda a: SEPSIS_KINDS.index(a["kind"]))
    return [{"kind": a["kind"], "severity": a.get("severity"), "first_seen_at": a.get("first_seen_at"),
             "resolved_at": a.get("resolved_at"), "acknowledged": bool(a.get("acknowledged")),
             "snooze_until": (a.get("snooze") or {}).get("until")} for a in alerts]


def _firing(alarms: list[dict]) -> bool:
    return any(alarm["resolved_at"] is None for alarm in alarms)


def row_of(card: dict) -> dict:
    """One row from one scoped card (spec D10, §5 S2, M3, M4). A card the bed table places on no unit has `unit_id`
    None; a card with no identity an empty label and name."""
    identity = card.get("identity") or {}
    antibiotic = antibiotic_of(card.get("meds"))
    alarms = sepsis_alarms_of(card)
    return {
        "patient_id": card["patient_id"],
        "bed_label": identity.get("bed_label") or "",
        "bed_id": identity.get("bed_id") or None,
        "unit_id": identity.get("unit_id") or None,
        "display_name": identity.get("display_name") or "",
        "isolation": isolation_of(card),
        "suspected_infection": suspected_of(card),
        "antibiotic": antibiotic,
        "sepsis_alarms": alarms,
        "sort_group": 0 if antibiotic["state"] in CLOCK_OPEN else 1 if _firing(alarms) else 2,
    }


def counts_of(rows: list[dict]) -> dict:
    """The page's counters (spec D10, §5 A3, M3): the scoped cards; the cards in isolation and those with no isolation
    record at all; the cards with suspected infection charted TRUE and those with no mark at all (a card with no
    `sepsis` block among them); the passed antibiotic clocks; and the patients with a FIRING alarm of the three kinds,
    answered or not — a latched one is listed, not counted."""
    return {
        "patients": len(rows),
        "isolated": sum(1 for row in rows if row["isolation"]["state"] == ISOLATED),
        "isolation_unrecorded": sum(1 for row in rows if row["isolation"]["state"] == UNRECORDED),
        "suspected": sum(1 for row in rows if row["suspected_infection"] is True),
        "suspected_unrecorded": sum(1 for row in rows if row["suspected_infection"] is None),
        "clock_missed": sum(1 for row in rows if row["antibiotic"]["state"] == "missed"),
        "sepsis_open": sum(1 for row in rows if _firing(row["sepsis_alarms"])),
    }


def ward_infection(cards: list[dict], *, now: datetime) -> dict:
    """The answer of GET /infection without its scope block (spec D10 and the answer after §5). `cards` are the
    caller's scoped board cards; `units` names every unit a card is on, with that unit's counts (a card on no unit is
    counted only in the whole); a card with a bed is one `bed_occupants` entry. A board with no card answers the whole
    shape: zeros and empty lists."""
    rows = sorted((row_of(card) for card in cards), key=lambda row: row["patient_id"])
    units = sorted({row["unit_id"] for row in rows if row["unit_id"]})
    return {
        "now": _iso(now),
        "antibiotic_window_min": int(ANTIBIOTIC_WINDOW.total_seconds() // 60),
        "antibiotic_window_source": ANTIBIOTIC_WINDOW_SOURCE,
        "counts": counts_of(rows),
        "units": [{"unit_id": unit, "counts": counts_of([row for row in rows if row["unit_id"] == unit])}
                  for unit in units],
        "isolated": [row for row in rows if row["isolation"]["state"] == ISOLATED],
        "suspected": [row for row in rows if row["suspected_infection"] is True or row["sepsis_alarms"]],
        "bed_occupants": [{"bed_id": row["bed_id"], "patient_id": row["patient_id"],
                           "display_name": row["display_name"],
                           "isolation": {"state": row["isolation"]["state"], "types": list(row["isolation"]["types"])}}
                          for row in rows if row["bed_id"]],
    }
```

- [ ] **Step 5: Mount the route**

In `homunculus-engine/src/homunculus/api/app.py`, find:

```python
(PHARMACY_VIEW,) = validate_permissions(("pharmacy.view",))       # G3-04: «Eczane»
```

Replace with:

```python
(PHARMACY_VIEW,) = validate_permissions(("pharmacy.view",))       # G3-04: «Eczane»
(INFECTION_VIEW,) = validate_permissions(("infection.view",))     # G4-05: «Enfeksiyon kontrol»
```

Then find:

```python
from homunculus.api.pharmacy import ward_pharmacy                 # G3-04
```

Replace with:

```python
from homunculus.api.pharmacy import ward_pharmacy                 # G3-04
from homunculus.api.infection import ward_infection               # G4-05
```

Then find:

```python
        return {**answer, "scope": result.as_dict(), "scope_note": scope_report(result)}

    @app.get("/patients/{patient_id}/trends")
```

Replace with:

```python
        return {**answer, "scope": result.as_dict(), "scope_note": scope_report(result)}

    @app.get("/infection")
    async def infection(authorization: str | None = Header(default=None)):
        """G4-05 «Enfeksiyon kontrol»: the infection-control page (`api/infection.py`) — one row per card of the
        caller's scoped board, read through `_board_for` as `/patients` and `/pharmacy` are: the isolated patients, the
        patients with suspected infection or a Sepsis-3 alarm with Eczane's antibiotic state, who lies on each bed, and
        the counts (spec D4, D10, §5). The answer carries `/patients`' own `scope` block and `scope_note`. The isolation
        beds are drawn by the page from the structure tree (§5 S1): no database is read here. Read-only and not
        audited, as `/pharmacy` (a poll would bury the trail); a device token passes, as on every board route. `now`
        is taken right after the board was built, as `/pharmacy`'s."""
        _, _, result = await _board_for(authorization, INFECTION_VIEW)
        now = datetime.now(timezone.utc)
        return {**ward_infection(result.boards, now=now), "scope": result.as_dict(), "scope_note": scope_report(result)}

    @app.get("/patients/{patient_id}/trends")
```

- [ ] **Step 6: Run the tests to see them pass**

Run: `cd /c/tmp/g4-enfeksiyon/homunculus-engine && "/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest tests/test_infection.py tests/test_infection_api.py tests/test_pharmacy.py tests/test_pharmacy_api.py -q -p no:cacheprovider`
Expected: `85 passed`.

The route tables do not know `/infection` yet: until Task 6, three guard tests are red by design (plan note N12).

- [ ] **Step 7: Commit**

```bash
cd /c/tmp/g4-enfeksiyon && git add homunculus-engine/src/homunculus/api/infection.py homunculus-engine/src/homunculus/api/app.py homunculus-engine/tests/test_infection.py homunculus-engine/tests/test_infection_api.py && git commit -m "feat(api): G4-05 GET /infection — infection.view, the scoped board through _board_for: the isolated and the suspected rows (Eczane's antibiotic object, the three Sepsis-3 kinds firing and latched, sort_group), bed_occupants, the counts whole and per unit with isolation_unrecorded and suspected_unrecorded, /patients' scope; not audited" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- homunculus-engine/src/homunculus/api/infection.py homunculus-engine/src/homunculus/api/app.py homunculus-engine/tests/test_infection.py homunculus-engine/tests/test_infection_api.py
```

---

## Task 5 (engine): an existing room marked or unmarked as an isolation room (§5 O1)

**Files:**
- Modify: `homunculus-engine/src/homunculus/tenant/schemas.py` (`RoomPatch`)
- Modify: `homunculus-engine/src/homunculus/tenant/router.py` (the module docstring's audit line; `_changes`; `patch_room`)
- Test: `homunculus-engine/tests/test_structure_api.py` (a test after the room-number test; `_AUDITED_WRITES`) — DB-backed

- [ ] **Step 1: Write the failing tests**

In `homunculus-engine/tests/test_structure_api.py`, find:

```python
        {"kind": "room", "id": o2, "unit_id": rea, "old_name": "Otaq 2", "new_name": "Otaq 2A",
         "old_room_number": "1" * 20, "new_room_number": None, "actor": ADMIN},
    ]
```

Replace with:

```python
        {"kind": "room", "id": o2, "unit_id": rea, "old_name": "Otaq 2", "new_name": "Otaq 2A",
         "old_room_number": "1" * 20, "new_room_number": None, "actor": ADMIN},
    ]


async def test_an_existing_room_is_marked_and_unmarked_as_an_isolation_room_one_row_per_change(ward):
    """G4-05 (spec §5 O1): `is_isolation` on an existing room, under its unit's lock, `structure.manage` only. A change
    writes one `structure.isolation` row — the kind, the id, the unit, the old and the new flag, the actor — never a
    `structure.rename` (which «Denetim bütünlüğü» prints «Yapı: adı değişti»); the same value again writes none; a rename
    sent with it writes its own row beside it. The tree every screen reads carries the new flag."""
    w, client, app = ward
    admin = w.auth["admin"]
    o2, rea = str(w.rooms["o2"].id), str(w.units["rea"].id)
    r = await client.patch(f"/tenant/rooms/{o2}", json={"is_isolation": True}, headers=admin)
    assert (r.status_code, r.json()["is_isolation"]) == (200, True), r.text
    tree = (await client.get("/tenant/structure", headers=admin)).json()
    flags = {room["name"]: room["is_isolation"] for site in tree["sites"] for unit in site["units"]
             for room in unit["rooms"]}
    assert (flags["Otaq 1"], flags["Otaq 2"]) == (False, True)
    r = await client.patch(f"/tenant/rooms/{o2}", json={"is_isolation": True}, headers=admin)      # unchanged
    assert (r.status_code, r.json()["is_isolation"]) == (200, True), r.text
    r = await client.patch(f"/tenant/rooms/{o2}", json={"name": "Otaq 2A", "is_isolation": False}, headers=admin)
    assert (r.status_code, r.json()["name"], r.json()["is_isolation"]) == (200, "Otaq 2A", False), r.text
    assert [row.payload for row in _rows(app, "structure.isolation")] == [
        {"kind": "room", "id": o2, "unit_id": rea, "old_is_isolation": False, "new_is_isolation": True, "actor": ADMIN},
        {"kind": "room", "id": o2, "unit_id": rea, "old_is_isolation": True, "new_is_isolation": False, "actor": ADMIN},
    ]
    assert [row.payload for row in _rows(app, "structure.rename")] == [
        {"kind": "room", "id": o2, "unit_id": rea, "old_name": "Otaq 2", "new_name": "Otaq 2A", "actor": ADMIN}]


async def test_only_structure_manage_marks_an_isolation_room(ward):
    w, client, app = ward
    r = await client.patch(f"/tenant/rooms/{w.rooms['o2'].id}", json={"is_isolation": True}, headers=w.auth["charge"])
    assert (r.status_code, r.json()["detail"]) == (403, "permission required: structure.manage")
    assert _rows(app, "structure.isolation") == []
```

Then find:

```python
    "room patch": ("PATCH", lambda w: f"/tenant/rooms/{w.rooms['o2'].id}",
                   {"name": "Sentetik Otaq 2"}, "admin", 200, "structure.rename"),
```

Replace with:

```python
    "room patch": ("PATCH", lambda w: f"/tenant/rooms/{w.rooms['o2'].id}",
                   {"name": "Sentetik Otaq 2"}, "admin", 200, "structure.rename"),
    "room isolation": ("PATCH", lambda w: f"/tenant/rooms/{w.rooms['o2'].id}",           # G4-05 (spec §5 O1)
                       {"is_isolation": True}, "admin", 200, "structure.isolation"),
```

- [ ] **Step 2: Run them on the throwaway Postgres to see them fail**

Start the database (the execution rules' two calls). Run: `cd /c/tmp/g4-enfeksiyon/homunculus-engine && TEST_DATABASE_URL=postgresql+asyncpg://postgres:ozet@127.0.0.1:56460/ozet_test "/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest tests/test_structure_api.py -q -p no:cacheprovider`
Expected: `2 failed, 40 passed`: `test_an_existing_room_is_marked_and_unmarked_as_an_isolation_room_one_row_per_change` and `test_an_audit_store_failing_after_the_commit_still_answers_success_and_logs[room isolation]`. `test_only_structure_manage_marks_an_isolation_room` passes already: the 403 comes before the body is read.

- [ ] **Step 3: Take the flag on the room's PATCH and audit it as its own change**

In `homunculus-engine/src/homunculus/tenant/schemas.py`, find:

```python
class RoomPatch(BaseModel):
    name: _Rename100 | None = None
    room_number: _Number20 | None = None
    is_active: bool | None = None
```

Replace with:

```python
class RoomPatch(BaseModel):
    name: _Rename100 | None = None
    room_number: _Number20 | None = None
    is_active: bool | None = None
    is_isolation: bool | None = None        # G4-05 (spec §5 O1): mark or unmark an existing room as an isolation room
```

In `homunculus-engine/src/homunculus/tenant/router.py`, find:

```python
Every structure write — create a site, unit, room or bed; rename, close or reopen one — writes one
audit row per change (`structure.create|rename|close|reopen`: the kind, the id, the unit, the old
and new name or `is_active`, the actor; never a patient) through admission/trail.py, after its
```

Replace with:

```python
Every structure write — create a site, unit, room or bed; rename, close or reopen one; mark a room as
an isolation room or unmark it (G4-05, spec §5 O1) — writes one audit row per change
(`structure.create|rename|close|reopen|isolation`: the kind, the id, the unit, the old and new name,
`is_active` or `is_isolation`, the actor; never a patient) through admission/trail.py, after its
```

Then find:

```python
def _changes(*, old_name: str, new_name: str, was_active: bool, is_active: bool,
             renamed_too: dict | None = None) -> list[tuple[str, dict]]:
    """The audit rows one PATCH owes (amendment A-4): a rename and a close sent together are two
    changes and two rows; what did not change writes nothing."""
```

Replace with:

```python
def _changes(*, old_name: str, new_name: str, was_active: bool, is_active: bool,
             renamed_too: dict | None = None, was_isolation: bool | None = None,
             is_isolation: bool | None = None) -> list[tuple[str, dict]]:
    """The audit rows one PATCH owes (amendment A-4): a rename and a close sent together are two
    changes and two rows; what did not change writes nothing. G4-05 (spec §5 O1): a room's isolation
    mark is a change of its own, `structure.isolation` — not a `structure.rename`, which «Denetim
    bütünlüğü» prints «Yapı: adı değişti»; a unit and a bed pass no flag."""
```

Then find:

```python
    if is_active != was_active:
        out.append(("structure.reopen" if is_active else "structure.close",
                    {"old_is_active": was_active, "new_is_active": is_active}))
    return out
```

Replace with:

```python
    if is_active != was_active:
        out.append(("structure.reopen" if is_active else "structure.close",
                    {"old_is_active": was_active, "new_is_active": is_active}))
    if is_isolation is not None and is_isolation != was_isolation:
        out.append(("structure.isolation",
                    {"old_is_isolation": was_isolation, "new_is_isolation": is_isolation}))
    return out
```

Then find:

```python
    renumbered = ({"old_room_number": room.room_number, "new_room_number": number}
                  if number != room.room_number else {})
    changes = _changes(old_name=room.name, new_name=name, was_active=room.is_active,
                       is_active=is_active, renamed_too=renumbered)
    hospital = await trail.hospital_of(db, caller_tenant)
    room.name, room.room_number, room.is_active = name, number, is_active
```

Replace with:

```python
    renumbered = ({"old_room_number": room.room_number, "new_room_number": number}
                  if number != room.room_number else {})
    # G4-05 (spec §5 O1): an existing room marked or unmarked as an isolation room, under the unit's lock above.
    is_isolation = room.is_isolation if body.is_isolation is None else body.is_isolation
    changes = _changes(old_name=room.name, new_name=name, was_active=room.is_active,
                       is_active=is_active, renamed_too=renumbered,
                       was_isolation=room.is_isolation, is_isolation=is_isolation)
    hospital = await trail.hospital_of(db, caller_tenant)
    room.name, room.room_number, room.is_active, room.is_isolation = name, number, is_active, is_isolation
```

- [ ] **Step 4: Run the tests to see them pass, then stop the database**

Run: `cd /c/tmp/g4-enfeksiyon/homunculus-engine && TEST_DATABASE_URL=postgresql+asyncpg://postgres:ozet@127.0.0.1:56460/ozet_test "/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest tests/test_structure_api.py -q -p no:cacheprovider`
Expected: `42 passed`.

Then: `docker stop enfeksiyon-pg`

- [ ] **Step 5: Commit**

```bash
cd /c/tmp/g4-enfeksiyon && git add homunculus-engine/src/homunculus/tenant/schemas.py homunculus-engine/src/homunculus/tenant/router.py homunculus-engine/tests/test_structure_api.py && git commit -m "feat(tenant): G4-05 an existing room marked or unmarked as an isolation room — RoomPatch.is_isolation under the unit lock, structure.manage, audited as its own structure.isolation row (spec §5 O1)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- homunculus-engine/src/homunculus/tenant/schemas.py homunculus-engine/src/homunculus/tenant/router.py homunculus-engine/tests/test_structure_api.py
```

---

## Task 6 (engine): `/infection` in the route tables, tenant isolation and the proxied paths

**Files:**
- Test: `homunculus-engine/tests/test_board_permissions.py` (`BOARD_EXPECTED`, 28 → 29)
- Test: `homunculus-engine/tests/test_tenant_isolation.py` (`UNSCOPED_BY_DESIGN`)
- Test: `homunculus-engine/tests/test_nginx_routes.py` (`API_PATHS`, 35 → 36)
- Modify: `deploy/local/web/nginx.conf` (the API `location` regex)

Already covered with no edit (spec D12): `tests/test_route_permissions.py` `EXPECTED` (77, router modules only); the access-log map (`/infection` has no path parameter and no patient key: `default $uri`), so `tests/test_access_log_redaction.py` passes unchanged. `dashboard/vite.config.js`'s proxy is the dashboard lane's (Task 9).

- [ ] **Step 1: Run the guard tests to see what Task 4 left red**

Run: `cd /c/tmp/g4-enfeksiyon/homunculus-engine && "/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest tests/test_board_permissions.py tests/test_tenant_isolation.py tests/test_nginx_routes.py tests/test_route_permissions.py tests/test_access_log_redaction.py tests/test_route_inventory.py -q -p no:cacheprovider`
Expected: `3 failed, 155 passed, 137 skipped` — `test_board_permissions.py::test_the_table_names_every_board_route_and_only_those`, `test_tenant_isolation.py::test_every_route_resolves_the_callers_tenant_unless_unscoped_by_design` and `test_nginx_routes.py::test_every_app_route_prefix_is_proxied`: Task 4's route is in no table yet (plan note N12).

- [ ] **Step 2: Name the route in the three tables**

In `homunculus-engine/tests/test_board_permissions.py`, find:

```python
    # G3-04: «Eczane» (api/pharmacy.py) — the pharmacist's ward page, its own right; the device token passes
    # as on every board route (spec D4, O6).
    ("GET", "/pharmacy"): "pharmacy.view",
```

Replace with:

```python
    # G3-04: «Eczane» (api/pharmacy.py) — the pharmacist's ward page, its own right; the device token passes
    # as on every board route (spec D4, O6).
    ("GET", "/pharmacy"): "pharmacy.view",
    # G4-05: «Enfeksiyon kontrol» (api/infection.py) — as /pharmacy: its own right, the device token passes (spec D10).
    ("GET", "/infection"): "infection.view",
```

In `homunculus-engine/tests/test_tenant_isolation.py`, find:

```python
    # G3-04's Eczane page (api/pharmacy.py): the board's Caller and `_board_for`, pharmacy.view — the caller's own
    # hospital and scoped cards, as /patients.
    ("GET", "/pharmacy"),
```

Replace with:

```python
    # G3-04's Eczane page (api/pharmacy.py): the board's Caller and `_board_for`, pharmacy.view — the caller's own
    # hospital and scoped cards, as /patients.
    ("GET", "/pharmacy"),
    # G4-05's Enfeksiyon kontrol page (api/infection.py): as /pharmacy — the board's Caller and `_board_for`,
    # infection.view; the caller's own hospital and scoped cards.
    ("GET", "/infection"),
```

In `homunculus-engine/tests/test_nginx_routes.py`, find:

```python
    "/infinity-waves/192.0.2.10", "/patients", "/pharmacy", "/quality", "/ack",
```

Replace with:

```python
    "/infinity-waves/192.0.2.10", "/patients", "/pharmacy", "/quality", "/ack",
    "/infection",                                  # G4-05: «Enfeksiyon kontrol»
```

- [ ] **Step 3: Proxy it**

In `deploy/local/web/nginx.conf`, find:

```nginx
    location ~ ^/(auth|admin|tenant|admissions|shift-schedule|handovers|alerts|break-glass|scope|clinical|scores|alarm-quality|infinity-research|infinity-shadow|infinity-waves|patients|ack|ingest|view|audit|health|tasks|pharmacy|readings|quality)(/|$) {
```

Replace with:

```nginx
    location ~ ^/(auth|admin|tenant|admissions|shift-schedule|handovers|alerts|break-glass|scope|clinical|scores|alarm-quality|infinity-research|infinity-shadow|infinity-waves|patients|ack|ingest|view|audit|health|tasks|pharmacy|readings|quality|infection)(/|$) {
```

- [ ] **Step 4: Run the guard tests to see them pass**

Run: `cd /c/tmp/g4-enfeksiyon/homunculus-engine && "/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest tests/test_board_permissions.py tests/test_tenant_isolation.py tests/test_nginx_routes.py tests/test_route_permissions.py tests/test_access_log_redaction.py tests/test_route_inventory.py -q -p no:cacheprovider`
Expected: `161 passed, 137 skipped` (the skips are DB-backed; Task 18 runs them on Postgres).

- [ ] **Step 5: Commit**

```bash
cd /c/tmp/g4-enfeksiyon && git add homunculus-engine/tests/test_board_permissions.py homunculus-engine/tests/test_tenant_isolation.py homunculus-engine/tests/test_nginx_routes.py deploy/local/web/nginx.conf && git commit -m "test(routes): G4-05 GET /infection in BOARD_EXPECTED (29, infection.view), UNSCOPED_BY_DESIGN and API_PATHS (36); nginx proxies it" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- homunculus-engine/tests/test_board_permissions.py homunculus-engine/tests/test_tenant_isolation.py homunculus-engine/tests/test_nginx_routes.py deploy/local/web/nginx.conf
```

---

## Task 7 (engine): migration `0023_infection_view`

**Files:**
- Create: `homunculus-engine/alembic/versions/0023_infection_view.py`
- Test: `homunculus-engine/tests/test_migration_0023_infection_view.py` (new; one no-DB test, three DB-backed)

- [ ] **Step 1: Write the failing test**

Create `homunculus-engine/tests/test_migration_0023_infection_view.py` with:

```python
# homunculus-engine/tests/test_migration_0023_infection_view.py
"""Migration 0023 (G4-05 Enfeksiyon kontrol, spec D2, D21, §5 A2, M5) on the real chain (`clean_db`, never
`create_all`):
- the tenants seeded before it get `infection.view` on their `attending`, `unit_physician`, `physician`,
  `charge_nurse` and `nurse` groups, in every tenant; a `pharmacist`, a `rapid_response`, an `auditor`, a hospital's
  own group and `hospital_admin` get no row (the system group holds the catalogue by rule);
- the statement is idempotent (a group that already holds the key, a second run);
- the downgrade removes the key's rows and leaves the groups and their other rows; 0021 → 0023 → 0021 → 0023 runs;
- the head is checked BY ANCESTRY, never by the names' order: TRƏS may renumber onto this one, or this onto it
  (plan note N20).
The first test needs no database: the migration's slugs, its statement and `DEFAULT_GROUPS` say the same five groups,
or a migrated hospital and a new one would differ. Synthetic rows only."""
from __future__ import annotations

import importlib.util
import re
import uuid
from pathlib import Path

from alembic import command
from alembic.script import ScriptDirectory
from sqlalchemy import text

from homunculus.auth.permissions import DEFAULT_GROUPS
from tests.conftest import requires_db

KEY = "infection.view"
#: (revision, down_revision) — the one line a renumber changes here (plan note N20).
CHAIN = ("0023", "0021")
HOLDERS = {"attending", "unit_physician", "physician", "charge_nurse", "nurse"}
_GRANTS = ("SELECT t.slug, g.slug FROM group_permissions gp JOIN groups g ON g.id = gp.group_id "
           "JOIN tenants t ON t.id = g.tenant_id WHERE gp.permission = 'infection.view'")


def _migration():
    """The migration module, loaded by its path (its name starts with a digit, so it is not importable)."""
    path = Path(__file__).resolve().parents[1] / "alembic" / "versions" / "0023_infection_view.py"
    spec = importlib.util.spec_from_file_location("migration_0023_infection_view", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_the_migration_names_the_groups_the_catalogue_gives_the_key_to():
    migration = _migration()
    assert (migration.revision, migration.down_revision, migration.KEY) == (*CHAIN, KEY)
    seeded = {g["slug"] for g in DEFAULT_GROUPS if KEY in g["permissions"] and not g["is_system"]}
    assert set(migration.GROUPS) == seeded == HOLDERS
    assert set(re.findall(r"'([a-z_]+)'", migration.GRANT.split("WHERE slug IN", 1)[1])) == HOLDERS
    assert "'infection.view'" in migration.GRANT and migration.GRANT.endswith("ON CONFLICT DO NOTHING")
    assert migration.REVOKE == "DELETE FROM group_permissions WHERE permission = 'infection.view'"
    assert ";" not in migration.GRANT + migration.REVOKE          # one statement per op.execute (asyncpg)


def _tenant(conn, slug: str) -> uuid.UUID:
    tid = uuid.uuid4()
    conn.execute(text("INSERT INTO tenants (id, name, slug, country_code) VALUES (:id, :n, :s, 'AZ')"),
                 {"id": tid, "n": f"Sentetik {slug}", "s": slug})
    return tid


def _group(conn, tenant: uuid.UUID, slug: str, *permissions: str, system: bool = False) -> uuid.UUID:
    gid = uuid.uuid4()
    conn.execute(text(
        "INSERT INTO groups (id, tenant_id, slug, name, description, mfa_required, is_system, "
        "created_at, updated_at) VALUES (:id, :t, :s, :s, '', false, :sys, now(), now())"),
        {"id": gid, "t": tenant, "s": slug, "sys": system})
    for key in permissions:
        conn.execute(text("INSERT INTO group_permissions (group_id, permission) VALUES (:g, :p)"),
                     {"g": gid, "p": key})
    return gid


def _ward(conn) -> None:
    """Two tenants seeded before 0023: hastane-a with the five holders, the three groups that do not hold it, the system
    group and a group of its own; hastane-b with a nurse and a pharmacist."""
    a, b = _tenant(conn, "hastane-a"), _tenant(conn, "hastane-b")
    _group(conn, a, "attending", "board.view")
    _group(conn, a, "unit_physician", "board.view")
    _group(conn, a, "physician", "board.view", "alerts.ack")
    _group(conn, a, "charge_nurse", "board.view")
    _group(conn, a, "nurse", "board.view", "alerts.ack")
    _group(conn, a, "pharmacist", "board.view", "pharmacy.view")
    _group(conn, a, "rapid_response", "board.view")
    _group(conn, a, "auditor", "board.view", "audit.view")
    _group(conn, a, "hospital_admin", "board.view", system=True)
    _group(conn, a, "gece_ekibi", "board.view")
    _group(conn, b, "nurse", "board.view")
    _group(conn, b, "pharmacist", "board.view")


def _grants(conn) -> set[tuple[str, str]]:
    return {tuple(row) for row in conn.execute(text(_GRANTS))}


def _other_rows(conn) -> int:
    return conn.execute(text("SELECT count(*) FROM group_permissions WHERE permission <> 'infection.view'")).scalar_one()


@requires_db
def test_the_upgrade_gives_the_key_to_the_five_groups_of_every_tenant_and_to_no_other(clean_db):
    engine, cfg = clean_db
    command.upgrade(cfg, CHAIN[1])
    with engine.begin() as conn:
        _ward(conn)
        before = _other_rows(conn)
    command.upgrade(cfg, CHAIN[0])
    with engine.connect() as conn:
        grants, after = _grants(conn), _other_rows(conn)
    assert grants == {("hastane-a", slug) for slug in HOLDERS} | {("hastane-b", "nurse")}
    assert after == before == 16                                  # no other row was touched
    command.upgrade(cfg, "head")                                  # at 0023 or past it: a later migration may follow
    with engine.connect() as conn:
        assert _grants(conn) == grants
        version = conn.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
    # «At 0023 or past it» by the revision graph, never by the names' order (spec D21, §5 M5).
    assert CHAIN[0] in {s.revision for s in ScriptDirectory.from_config(cfg).iterate_revisions(version, "base")}


@requires_db
def test_the_statement_is_idempotent(clean_db):
    engine, cfg = clean_db
    command.upgrade(cfg, CHAIN[1])
    with engine.begin() as conn:
        tenant = _tenant(conn, "hastane-a")
        _group(conn, tenant, "nurse", "board.view", KEY)               # a hospital gave it by hand already
        _group(conn, tenant, "physician", "board.view")
    command.upgrade(cfg, CHAIN[0])
    with engine.begin() as conn:
        conn.execute(text(_migration().GRANT))
        conn.execute(text(_migration().GRANT))
        grants = _grants(conn)
        rows = conn.execute(text("SELECT count(*) FROM group_permissions WHERE permission = 'infection.view'")).scalar_one()
    assert grants == {("hastane-a", "nurse"), ("hastane-a", "physician")} and rows == 2


@requires_db
def test_the_downgrade_removes_the_keys_rows_and_leaves_the_groups_and_their_other_rows(clean_db):
    engine, cfg = clean_db
    command.upgrade(cfg, CHAIN[1])
    with engine.begin() as conn:
        _ward(conn)
        before = _other_rows(conn)
    command.upgrade(cfg, CHAIN[0])
    with engine.begin() as conn:          # after the upgrade a hospital gives its own group the key
        conn.execute(text("INSERT INTO group_permissions (group_id, permission) "
                          "SELECT id, 'infection.view' FROM groups WHERE slug = 'gece_ekibi'"))
    command.downgrade(cfg, CHAIN[1])
    with engine.connect() as conn:
        grants, after = _grants(conn), _other_rows(conn)
        groups = conn.execute(text("SELECT count(*) FROM groups")).scalar_one()
        version = conn.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
    assert grants == set() and after == before == 16 and groups == 12 and version == CHAIN[1]
    command.upgrade(cfg, CHAIN[0])
    with engine.connect() as conn:
        assert len(_grants(conn)) == 6
```

- [ ] **Step 2: Run it on the throwaway Postgres to see it fail**

Start the database (the execution rules' two calls). Run: `cd /c/tmp/g4-enfeksiyon/homunculus-engine && TEST_DATABASE_URL=postgresql+asyncpg://postgres:ozet@127.0.0.1:56460/ozet_test "/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest tests/test_migration_0023_infection_view.py -q -p no:cacheprovider`
Expected: `4 failed`: the no-DB test cannot find `0023_infection_view.py` (`FileNotFoundError`), and the three on the chain cannot find the revision (`Can't locate revision identified by '0023'`).

- [ ] **Step 3: Write the migration**

Create `homunculus-engine/alembic/versions/0023_infection_view.py` with:

```python
# homunculus-engine/alembic/versions/0023_infection_view.py
"""G4-05 Enfeksiyon kontrol (spec D2, D21, §5 A2, M5): `infection.view` for the default groups of the ward's clinicians,
in every tenant

Revision 0023, follows G3-05's 0021 (vital_readings), the head of main when this was written (the chain is … 0020 →
0022 → 0021). The TRƏS branch (`feat/tres-esaglik`) also plans a revision on 0021: whichever of the two reaches main
second is renumbered onto the head of that moment — this file's name, `revision`, `down_revision`, this docstring, and
its test's file name and CHAIN tuple. The tests check the head by ancestry, never by the names' order.
* `group_permissions`: one `infection.view` row for each `attending`, `unit_physician`, `physician`, `charge_nurse` and
  `nurse` group, by slug, in every tenant (0019's pattern). `ensure_default_groups` creates missing groups only, so the
  tenants seeded before this revision get the key here; a tenant seeded after it gets it from `DEFAULT_GROUPS`
  (auth/permissions.py). `hospital_admin` needs no row: the system group holds the whole catalogue by rule. A
  hospital's own group gets nothing: the hospital gives it the key itself, in Yönetim › Roller.
No table, no column.

ROLLBACK (§5 A2). An image from before this revision does not start against it: its start command's `alembic upgrade
head` refuses the unknown revision ("Can't locate revision identified by '0023'"). A rollback therefore runs `alembic
downgrade` FIRST, in a one-off container of THIS revision's image, to the revision the server ran before this release
(in a release that carries other revisions too, that is the server's pre-release head, not this revision's
`down_revision`), and only then switches to the old image. The downgrade deletes the key's rows — every one, a row a
hospital gave another group after the upgrade included: the image the downgrade returns to does not know the key.
ONE STATEMENT PER op.execute (asyncpg; see 0004, 0010, 0013).

Revision ID: 0023
Revises: 0021
Create Date: 2026-11-12
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op

revision: str = "0023"
down_revision: Union[str, None] = "0021"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

KEY = "infection.view"
#: The five non-system default groups that hold the key (auth/permissions.py DEFAULT_GROUPS; spec D2).
#: tests/test_migration_0023_infection_view.py holds this tuple, GRANT and DEFAULT_GROUPS to one another.
GROUPS = ("attending", "unit_physician", "physician", "charge_nurse", "nurse")
GRANT = ("INSERT INTO group_permissions (group_id, permission) SELECT id, 'infection.view' FROM groups "
         "WHERE slug IN ('attending', 'unit_physician', 'physician', 'charge_nurse', 'nurse') ON CONFLICT DO NOTHING")
REVOKE = "DELETE FROM group_permissions WHERE permission = 'infection.view'"


def upgrade() -> None:
    op.execute(GRANT)


def downgrade() -> None:
    op.execute(REVOKE)
```

- [ ] **Step 4: Run the migration tests and the chain's other tests on the throwaway Postgres, then stop it**

Start the database (the execution rules' two calls). Run: `cd /c/tmp/g4-enfeksiyon/homunculus-engine && TEST_DATABASE_URL=postgresql+asyncpg://postgres:ozet@127.0.0.1:56460/ozet_test "/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest tests/test_migration_0023_infection_view.py tests/test_migration_0022_workload_view.py tests/test_migration_0021_vital_readings.py tests/test_migration_0019_pharmacy_view.py tests/test_migration_0010_schema_parity.py tests/test_audit_postgres.py -q -p no:cacheprovider`
Expected: `32 passed`, no skip.

Then: `docker stop enfeksiyon-pg`

- [ ] **Step 5: Commit**

```bash
cd /c/tmp/g4-enfeksiyon && git add homunculus-engine/alembic/versions/0023_infection_view.py homunculus-engine/tests/test_migration_0023_infection_view.py && git commit -m "feat(migration): G4-05 0023_infection_view on 0021 — infection.view for every tenant's default attending, unit-physician, physician, charge-nurse and nurse groups; data only; downgrade deletes the key's rows; the head checked by ancestry" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- homunculus-engine/alembic/versions/0023_infection_view.py homunculus-engine/tests/test_migration_0023_infection_view.py
```

The engine lane is done: report the seven shas to the coordinator.

---

# Dashboard lane (starts once Task 1 is committed)

## Task 8 (dashboard): the `enfeksiyon` strings and the permission mirrors

**Files:**
- Create: `dashboard/src/live/i18n/enfeksiyon.strings.test.js`
- Create: `dashboard/src/live/i18n/strings/enfeksiyon.js`
- Modify: `dashboard/src/live/i18n/catalog.js` (the import after `isyuku`; `NAMESPACES` after `isyuku`)
- Modify: `dashboard/src/live/i18n/strings/perms.js` (four languages: `infection.view` after `workload`)
- Modify: `dashboard/src/live/screens/admin/catalogue.js` (`PERMISSION_KEYS`, last)
- Modify: `dashboard/src/live/screens/admin/admin.testutil.js` (`PERMISSION_TEXTS`, last)

- [ ] **Step 1: Write the failing test**

Create `dashboard/src/live/i18n/enfeksiyon.strings.test.js` with:

```js
// G4-05 «Enfeksiyon kontrol» (spec 2026-11-12 D13, D18, §5 A3, A6, M7): the page's words (strings/enfeksiyon.js) — the
// spec's own Turkish, the Sepsis-3 alarm kinds in the criteria register (never a diagnosis), none of the prototype's
// formulas or rates, never «izolasyonsuz» for a patient nobody recorded, and no suffix glued to a number, a time or a
// name.
import { describe, it, expect } from "vitest";
import { DICTIONARIES } from "./catalog.js";
import { LANG_CODES } from "./langs.js";

const fill = (template, vars) => template.replace(/\{(\w+)\}/g, (_, name) => String(vars[name]));
const enfeksiyon = (lang) => Object.entries(DICTIONARIES[lang]).filter(([key]) => key.startsWith("enfeksiyon."));

describe("the infection-control page's words (enfeksiyon)", () => {
  it("says the spec's Turkish", () => {
    const tr = DICTIONARIES.tr;
    expect([tr["enfeksiyon.nav"], tr["enfeksiyon.navShort"], tr["enfeksiyon.title"]])
      .toEqual(["Enfeksiyon kontrol", "Enfeksiyon", "Enfeksiyon kontrol"]);
    expect(tr["enfeksiyon.intro"]).toBe("İzolasyon, şüpheli enfeksiyon, antibiyotik süresi ve sepsis alarmları");
    expect(["isolated", "freeBeds", "suspected", "clockMissed", "sepsisOpen"].map((key) => tr[`enfeksiyon.count.${key}`]))
      .toEqual(["izolasyonda kayıtlı hasta", "boş izolasyon yatağı", "şüpheli enfeksiyon işaretli hasta",
        "antibiyotik süresi aşan", "sepsis alarmı süren hasta"]);
    expect(fill(tr["enfeksiyon.count.isolationUnrecorded"], { n: 3 })).toBe("3 hastada izolasyon kaydı yok");
    expect(fill(tr["enfeksiyon.count.suspectedUnrecorded"], { n: 2 })).toBe("2 hastada işaret yok");
    expect(tr["enfeksiyon.count.sepsisOpenNote"]).toBe("yanıtlanmış ya da yanıtlanmamış");
    expect(tr["enfeksiyon.isolated.empty"]).toBe("Kapsamınızda izolasyonda kayıtlı hasta yok.");
    expect(tr["enfeksiyon.suspected.empty"])
      .toBe("Kapsamınızda şüpheli enfeksiyon işaretli ya da sepsis alarmı olan hasta yok.");
    expect(tr["enfeksiyon.beds.none"]).toBe("Kapsamınızda izolasyon odası tanımlı değil.");
    expect(tr["enfeksiyon.unit.gone"]).toBe("Seçili birim artık kapsamınızda değil.");
    expect(tr["enfeksiyon.isolated.note"]).toBe("İzolasyon, bir klinisyenin hasta ekranından bu sisteme kaydettiği önlem "
      + "türleridir; sistem izolasyon önermez, türünü seçmez. “İzolasyon kaydı yok”, kayıt yapılmadığını söyler; hastanın "
      + "izolasyonda olmadığı anlamına gelmez.");
    // §5 M7: no source says what this hospital's committee does.
    expect(tr["enfeksiyon.honesty"]).toBe("Bu sayfada yok: cihaz günleri (santral kateter, üriner kateter, ventilatör), "
      + "cihaz kullanım oranı, enfeksiyon oranları, antibiyotik günü ve kültür sonuçları — hiçbirinin bu sistemde kaynak "
      + "kaydı yok; hiçbiri hesaplanmadı. Enfeksiyon tanımı ve olay sayımı bu sistemin işi değildir; sistem eşik ya da "
      + "tanım üretmez. Homunculus tanı koymaz, order vermez.");
    expect(["contact", "droplet", "airborne", "protective"].map((type) => tr[`enfeksiyon.type.${type}`]))
      .toEqual(["Temas", "Damlacık", "Solunum", "Koruyucu"]);
    expect(fill(tr["enfeksiyon.stale"], { time: "09:30" })).toBe("Enfeksiyon listesi güncel değil · son yanıt 09:30");
    expect(fill(tr["enfeksiyon.beds.tally"], { occupied: 1, free: 2 })).toBe("1 dolu · 2 boş");
    expect(DICTIONARIES.az["enfeksiyon.nav"]).toBe("İnfeksiya nəzarəti");
  });

  it("names the alarm kinds as criteria met, never as a diagnosis (CLAUDE.md hard rule 5, §5 A6)", () => {
    expect(["septicShock", "sepsis", "underResuscitated"].map((kind) => DICTIONARIES.tr[`enfeksiyon.kind.${kind}`]))
      .toEqual(["Septik şok ölçütleri karşılandı", "Sepsis ölçütleri karşılandı", "Yeterli sıvıdan önce hipoperfüzyon"]);
    const criteria = { tr: "ölçütleri", az: "meyarları", ru: "Критерии", en: "criteria" };
    for (const lang of LANG_CODES) {
      for (const kind of ["septicShock", "sepsis"]) {
        expect(DICTIONARIES[lang][`enfeksiyon.kind.${kind}`], `${lang} ${kind}`).toContain(criteria[lang]);
      }
    }
  });

  it("carries none of the prototype's formulas or rates", () => {
    for (const lang of LANG_CODES) {
      for (const [key, value] of enfeksiyon(lang)) expect(value, `${lang} ${key}`).not.toMatch(/1000|‰|=|×|÷/);
    }
  });

  it("never calls a patient nobody recorded «izolasyonsuz»", () => {
    const tr = DICTIONARIES.tr;
    expect([tr["enfeksiyon.beds.tile.unrecorded"], tr["enfeksiyon.beds.tile.not_isolated"]])
      .toEqual(["izolasyon kaydı yok", "izolasyonsuz hasta"]);
    for (const key of ["enfeksiyon.beds.tile.unrecorded", "enfeksiyon.count.isolationUnrecorded", "enfeksiyon.isolated.note"]) {
      expect(tr[key], key).not.toMatch(/izolasyonsuz/);
    }
  });

  it("glues no suffix to a number, a time or a name in Turkish or Azerbaijani", () => {
    for (const lang of ["tr", "az"]) {
      for (const [key, value] of enfeksiyon(lang)) expect(value, `${lang} ${key}`).not.toMatch(/\{\w+\}[^\s·;,.:)–]/);
    }
  });
});
```

- [ ] **Step 2: Run it and the catalogue's mirror tests to see them fail**

Run: `cd /c/tmp/g4-enfeksiyon/dashboard && npx vitest run src/live/i18n/enfeksiyon.strings.test.js src/live/screens/admin/catalogue.test.js src/live/screens/admin/admin.testutil.test.js src/live/screens/admin/RolesTab.test.jsx`
Expected: `Tests  5 failed | 64 passed (69)` — three of the new file («says the spec's Turkish», «names the alarm kinds as criteria met, …», «never calls a patient nobody recorded «izolasyonsuz»»: no `enfeksiyon.*` key yet; its other two pass on no key), and the two mirror tests that read `permissions.py`: `catalogue.test.js` «has the backend's keys, in the backend's order» and `admin.testutil.test.js` «the permission descriptions are the server's, word for word». `RolesTab.test.jsx` passes.

- [ ] **Step 3: Write the namespace**

Create `dashboard/src/live/i18n/strings/enfeksiyon.js` with:

```js
// G4-05 «Enfeksiyon kontrol» (screens/enfeksiyon/, spec 2026-11-12 D13, D15, D18 and §5): who is in isolation, who has
// suspected infection or a Sepsis-3 alarm and how the antibiotic clock stands, and the isolation beds — per unit, as
// the system holds them. Every number is the server's, or «—» with its reason (`notFresh`, `structure.*`, `unit.none`,
// `room.*`): never a 0 or a «yok» without a fresh answer (Decision 18).
//
// THE REGISTER IS THE POINT. Isolation is what a clinician RECORDED — the page recommends none and chooses no type
// (`isolated.note`); «İzolasyon kaydı yok» says nothing was recorded, never that the patient is not isolated. The alarm
// kinds read as criteria met, the engine's own words (`kind.*`, §5 A6), never as a diagnosis. The honesty note names
// what the page does not have and why (§5 M7). None of the prototype's figures without a source — device days, device
// utilisation, infection rates, antibiotic days, cultures, a per-1000-device-day formula — is here.
//
// Reused from other namespaces, as they are (spec D18): Eczane's antibiotic cell (`eczane.ab.*`, `eczane.noRecord`,
// `eczane.dur.*`) and its two lines (`eczane.note`, `eczane.source`), `kabul.state.*` (a conflict tile's structure
// state), `alarms.resolvedUnacked`, `board.identityPending`, the scope note's strings.
//
// TR is the source; AZ is the default. AZ, RU and EN are the planner's and await a native reading before the pilot
// (spec O2). No suffix is glued to a number, a time or a name (enfeksiyon.strings.test.js). No text here is clinical
// advice.
export default {
  tr: {
    nav: "Enfeksiyon kontrol", navShort: "Enfeksiyon",
    title: "Enfeksiyon kontrol",
    intro: "İzolasyon, şüpheli enfeksiyon, antibiyotik süresi ve sepsis alarmları",
    asOf: "{time} itibarıyla",
    refresh: "Yenile",
    loading: "Enfeksiyon listesi okunuyor…",
    readFailed: "Enfeksiyon listesi okunamadı: {reason}",
    malformed: "sunucunun yanıtı bu sayfanın okuduğu biçimde değil",
    stale: "Enfeksiyon listesi güncel değil · son yanıt {time}",
    staleAsOf: "son yanıt {time} itibarıyla",
    notFresh: "liste güncel değil",
    unit: { label: "Birim", all: "Tüm birimler", gone: "Seçili birim artık kapsamınızda değil.", none: "birimi belli değil" },
    count: {
      isolated: "izolasyonda kayıtlı hasta",
      isolationUnrecorded: "{n} hastada izolasyon kaydı yok",
      freeBeds: "boş izolasyon yatağı",
      noRooms: "izolasyon odası tanımlı değil",
      suspected: "şüpheli enfeksiyon işaretli hasta",
      suspectedUnrecorded: "{n} hastada işaret yok",
      clockMissed: "antibiyotik süresi aşan",
      sepsisOpen: "sepsis alarmı süren hasta",
      sepsisOpenNote: "yanıtlanmış ya da yanıtlanmamış",
    },
    isolated: {
      title: "İzolasyondaki hastalar",
      caption: "İzolasyondaki hastalar: {n}",
      empty: "Kapsamınızda izolasyonda kayıtlı hasta yok.",
      note: "İzolasyon, bir klinisyenin hasta ekranından bu sisteme kaydettiği önlem türleridir; sistem izolasyon önermez, türünü seçmez. “İzolasyon kaydı yok”, kayıt yapılmadığını söyler; hastanın izolasyonda olmadığı anlamına gelmez.",
    },
    col: { bed: "Yatak · hasta", unit: "Birim", isolation: "İzolasyon", room: "Oda", antibiotic: "Antibiyotik", sepsis: "Sepsis alarmı" },
    lastRecord: "son kayıt {time}",
    room: { yes: "izolasyon odası", no: "izolasyon odasında değil", noBed: "yatağı bilinmiyor", unknownBed: "yatak yapıda bulunamadı" },
    beds: {
      title: "İzolasyon yatakları",
      tally: "{occupied} dolu · {free} boş",
      none: "Kapsamınızda izolasyon odası tanımlı değil.",
      lastAnswer: "son yanıtta",
      tile: {
        free: "boş", isolated: "izolasyonlu hasta", not_isolated: "izolasyonsuz hasta", unrecorded: "izolasyon kaydı yok",
        occupant_unseen: "dolu", occupantUnseenWhy: "hasta bu listede yok", conflict: "yapıda {state} · panoda hasta var",
        cleaning: "temizlikte", reserved: "rezerve", out_of_service: "kullanım dışı", maintenance: "bakımda",
      },
    },
    structure: { noRight: "yapı okunamıyor", failed: "yapı okunamadı: {reason}", loading: "okunuyor…" },
    suspected: {
      title: "Şüpheli enfeksiyon",
      caption: "Şüpheli enfeksiyon ya da sepsis alarmı: {n} hasta",
      empty: "Kapsamınızda şüpheli enfeksiyon işaretli ya da sepsis alarmı olan hasta yok.",
    },
    kind: { septicShock: "Septik şok ölçütleri karşılandı", sepsis: "Sepsis ölçütleri karşılandı",
      underResuscitated: "Yeterli sıvıdan önce hipoperfüzyon" },
    alarm: { none: "Açık sepsis alarmı yok", acknowledged: "onaylandı", snoozed: "ertelendi · bitiş {time}",
      lastAnswer: "son yanıtta: {kind}" },
    type: { contact: "Temas", droplet: "Damlacık", airborne: "Solunum", protective: "Koruyucu" },
    honesty: "Bu sayfada yok: cihaz günleri (santral kateter, üriner kateter, ventilatör), cihaz kullanım oranı, enfeksiyon oranları, antibiyotik günü ve kültür sonuçları — hiçbirinin bu sistemde kaynak kaydı yok; hiçbiri hesaplanmadı. Enfeksiyon tanımı ve olay sayımı bu sistemin işi değildir; sistem eşik ya da tanım üretmez. Homunculus tanı koymaz, order vermez.",
    unknown: "Bu sürümün tanımadığı durum: {state}",
  },
  az: {
    nav: "İnfeksiya nəzarəti", navShort: "İnfeksiya",
    title: "İnfeksiya nəzarəti",
    intro: "İzolyasiya, şübhəli infeksiya, antibiotik müddəti və sepsis siqnalları",
    asOf: "{time} vəziyyətinə görə",
    refresh: "Yenilə",
    loading: "İnfeksiya siyahısı oxunur…",
    readFailed: "İnfeksiya siyahısı oxunmadı: {reason}",
    malformed: "serverin cavabı bu səhifənin oxuduğu formada deyil",
    stale: "İnfeksiya siyahısı aktual deyil · son cavab {time}",
    staleAsOf: "son cavab {time} vəziyyətinə görə",
    notFresh: "siyahı aktual deyil",
    unit: { label: "Şöbə", all: "Bütün şöbələr", gone: "Seçilmiş şöbə artıq əhatənizdə deyil.", none: "şöbəsi bəlli deyil" },
    count: {
      isolated: "izolyasiyada qeydə alınmış xəstə",
      isolationUnrecorded: "{n} xəstədə izolyasiya qeydi yoxdur",
      freeBeds: "boş izolyasiya çarpayısı",
      noRooms: "izolyasiya otağı təyin edilməyib",
      suspected: "şübhəli infeksiya işarələnmiş xəstə",
      suspectedUnrecorded: "{n} xəstədə işarə yoxdur",
      clockMissed: "antibiotik müddəti keçən",
      sepsisOpen: "sepsis siqnalı davam edən xəstə",
      sepsisOpenNote: "cavablandırılmış və ya cavablandırılmamış",
    },
    isolated: {
      title: "İzolyasiyadakı xəstələr",
      caption: "İzolyasiyadakı xəstələr: {n}",
      empty: "Əhatənizdə izolyasiyada qeydə alınmış xəstə yoxdur.",
      note: "İzolyasiya klinisistin xəstə ekranından bu sistemə qeyd etdiyi tədbir növləridir; sistem izolyasiya tövsiyə etmir, növünü seçmir. “İzolyasiya qeydi yoxdur” qeydin edilmədiyini bildirir; xəstənin izolyasiyada olmadığı anlamına gəlmir.",
    },
    col: { bed: "Çarpayı · xəstə", unit: "Şöbə", isolation: "İzolyasiya", room: "Otaq", antibiotic: "Antibiotik", sepsis: "Sepsis siqnalı" },
    lastRecord: "son qeyd {time}",
    room: { yes: "izolyasiya otağı", no: "izolyasiya otağında deyil", noBed: "çarpayısı bəlli deyil", unknownBed: "çarpayı strukturda tapılmadı" },
    beds: {
      title: "İzolyasiya çarpayıları",
      tally: "{occupied} doludur · {free} boşdur",
      none: "Əhatənizdə izolyasiya otağı təyin edilməyib.",
      lastAnswer: "son cavabda",
      tile: {
        free: "boşdur", isolated: "izolyasiyalı xəstə", not_isolated: "izolyasiyasız xəstə", unrecorded: "izolyasiya qeydi yoxdur",
        occupant_unseen: "doludur", occupantUnseenWhy: "xəstə bu siyahıda yoxdur", conflict: "strukturda {state} · paneldə xəstə var",
        cleaning: "təmizlikdədir", reserved: "rezervdədir", out_of_service: "istifadədən kənardır", maintenance: "təmirdədir",
      },
    },
    structure: { noRight: "struktur oxuna bilmir", failed: "struktur oxunmadı: {reason}", loading: "oxunur…" },
    suspected: {
      title: "Şübhəli infeksiya",
      caption: "Şübhəli infeksiya və ya sepsis siqnalı: {n} xəstə",
      empty: "Əhatənizdə şübhəli infeksiya işarələnmiş və ya sepsis siqnalı olan xəstə yoxdur.",
    },
    kind: { septicShock: "Septik şok meyarları ödənilib", sepsis: "Sepsis meyarları ödənilib",
      underResuscitated: "Adekvat mayedən əvvəl hipoperfuziya" },
    alarm: { none: "Açıq sepsis siqnalı yoxdur", acknowledged: "təsdiqlənib", snoozed: "təxirə salınıb · bitmə {time}",
      lastAnswer: "son cavabda: {kind}" },
    type: { contact: "Təmas", droplet: "Damcı", airborne: "Hava yolu", protective: "Qoruyucu" },
    honesty: "Bu səhifədə yoxdur: cihaz günləri (mərkəzi kateter, sidik kateteri, ventilyator), cihazdan istifadə nisbəti, infeksiya nisbətləri, antibiotik günü və kultura nəticələri — heç birinin bu sistemdə mənbə qeydi yoxdur; heç biri hesablanmayıb. İnfeksiya tərifi və hadisə sayı bu sistemin işi deyil; sistem hədd və ya tərif yaratmır. Homunculus diaqnoz qoymur, təyinat vermir.",
    unknown: "Bu versiyanın tanımadığı vəziyyət: {state}",
  },
  ru: {
    nav: "Инфекционный контроль", navShort: "Инфекции",
    title: "Инфекционный контроль",
    intro: "Изоляция, подозрение на инфекцию, срок антибиотика и тревоги сепсиса",
    asOf: "по состоянию на {time}",
    refresh: "Обновить",
    loading: "Список инфекционного контроля загружается…",
    readFailed: "Список инфекционного контроля не прочитан: {reason}",
    malformed: "ответ сервера не в том виде, который читает эта страница",
    stale: "Список инфекционного контроля не актуален · последний ответ {time}",
    staleAsOf: "по последнему ответу на {time}",
    notFresh: "список не актуален",
    unit: { label: "Отделение", all: "Все отделения", gone: "Выбранное отделение больше не в вашей области.", none: "отделение неизвестно" },
    count: {
      isolated: "пациентов с записью об изоляции",
      isolationUnrecorded: "нет записи об изоляции: {n}",
      freeBeds: "свободных изоляционных коек",
      noRooms: "изоляторы не заданы",
      suspected: "пациентов с отметкой о подозрении на инфекцию",
      suspectedUnrecorded: "без отметки: {n}",
      clockMissed: "срок антибиотика пропущен",
      sepsisOpen: "пациентов с длящейся тревогой сепсиса",
      sepsisOpenNote: "с ответом или без ответа",
    },
    isolated: {
      title: "Пациенты в изоляции",
      caption: "Пациенты в изоляции: {n}",
      empty: "В вашей области нет пациентов с записью об изоляции.",
      note: "Изоляция — это виды мер, которые клиницист записал в эту систему с экрана пациента; система не рекомендует изоляцию и не выбирает её вид. «Нет записи об изоляции» означает, что запись не делалась, а не то, что пациент не изолирован.",
    },
    col: { bed: "Койка · пациент", unit: "Отделение", isolation: "Изоляция", room: "Палата", antibiotic: "Антибиотик", sepsis: "Тревога сепсиса" },
    lastRecord: "последняя запись {time}",
    room: { yes: "изолятор", no: "не в изоляторе", noBed: "койка неизвестна", unknownBed: "койки нет в структуре" },
    beds: {
      title: "Изоляционные койки",
      tally: "занято {occupied} · свободно {free}",
      none: "В вашей области изоляторы не заданы.",
      lastAnswer: "в последнем ответе",
      tile: {
        free: "свободна", isolated: "пациент в изоляции", not_isolated: "пациент без изоляции", unrecorded: "нет записи об изоляции",
        occupant_unseen: "занята", occupantUnseenWhy: "пациента нет в этом списке", conflict: "в структуре: {state} · на панели есть пациент",
        cleaning: "на уборке", reserved: "зарезервирована", out_of_service: "не используется", maintenance: "на обслуживании",
      },
    },
    structure: { noRight: "структура не читается", failed: "структура не прочитана: {reason}", loading: "загружается…" },
    suspected: {
      title: "Подозрение на инфекцию",
      caption: "Подозрение на инфекцию или тревога сепсиса: пациентов {n}",
      empty: "В вашей области нет пациентов с отметкой о подозрении на инфекцию или с тревогой сепсиса.",
    },
    kind: { septicShock: "Критерии септического шока выполнены", sepsis: "Критерии сепсиса выполнены",
      underResuscitated: "Гипоперфузия до адекватной инфузии" },
    alarm: { none: "Открытых тревог сепсиса нет", acknowledged: "подтверждено", snoozed: "отложено · до {time}",
      lastAnswer: "в последнем ответе: {kind}" },
    type: { contact: "Контактная", droplet: "Капельная", airborne: "Воздушная", protective: "Защитная" },
    honesty: "На этой странице нет: дней устройств (центральный катетер, мочевой катетер, ИВЛ), доли использования устройств, частоты инфекций, дней антибиотика и результатов посевов — ни для одного нет исходной записи в этой системе; ничего не рассчитано. Определение инфекций и подсчёт случаев — не задача этой системы; система не задаёт порогов и определений. Homunculus не ставит диагноз и не назначает лечение.",
    unknown: "Состояние, неизвестное этой версии: {state}",
  },
  en: {
    nav: "Infection control", navShort: "Infection",
    title: "Infection control",
    intro: "Isolation, suspected infection, the antibiotic clock and sepsis alarms",
    asOf: "as of {time}",
    refresh: "Refresh",
    loading: "Reading the infection-control list…",
    readFailed: "The infection-control list could not be read: {reason}",
    malformed: "the server's answer is not in the form this page reads",
    stale: "The infection-control list is not current · last answer {time}",
    staleAsOf: "as of the last answer at {time}",
    notFresh: "the list is not current",
    unit: { label: "Unit", all: "All units", gone: "The unit you chose is no longer in your scope.", none: "no unit known" },
    count: {
      isolated: "patients with isolation recorded",
      isolationUnrecorded: "no isolation record: {n}",
      freeBeds: "free isolation beds",
      noRooms: "no isolation room defined",
      suspected: "patients marked suspected infection",
      suspectedUnrecorded: "no mark: {n}",
      clockMissed: "antibiotic clock passed",
      sepsisOpen: "patients with a sepsis alarm on",
      sepsisOpenNote: "answered or not",
    },
    isolated: {
      title: "Patients in isolation",
      caption: "Patients in isolation: {n}",
      empty: "No patient in your scope has isolation recorded.",
      note: "Isolation is the precautions a clinician recorded in this system from the patient screen; the system does not recommend isolation or choose its type. “No isolation record” says nothing was recorded; it does not mean the patient is not in isolation.",
    },
    col: { bed: "Bed · patient", unit: "Unit", isolation: "Isolation", room: "Room", antibiotic: "Antibiotic", sepsis: "Sepsis alarm" },
    lastRecord: "last record {time}",
    room: { yes: "isolation room", no: "not in an isolation room", noBed: "bed unknown", unknownBed: "bed not found in the structure" },
    beds: {
      title: "Isolation beds",
      tally: "{occupied} occupied · {free} free",
      none: "No isolation room is defined in your scope.",
      lastAnswer: "in the last answer",
      tile: {
        free: "free", isolated: "patient in isolation", not_isolated: "patient not in isolation", unrecorded: "no isolation record",
        occupant_unseen: "occupied", occupantUnseenWhy: "the patient is not on this list", conflict: "the structure says {state} · a patient on the board",
        cleaning: "being cleaned", reserved: "reserved", out_of_service: "out of service", maintenance: "in maintenance",
      },
    },
    structure: { noRight: "the structure cannot be read", failed: "the structure could not be read: {reason}", loading: "reading…" },
    suspected: {
      title: "Suspected infection",
      caption: "Suspected infection or a sepsis alarm: {n} patients",
      empty: "No patient in your scope is marked suspected infection or has a sepsis alarm.",
    },
    kind: { septicShock: "Septic shock criteria met", sepsis: "Sepsis criteria met",
      underResuscitated: "Hypoperfusion before adequate fluid" },
    alarm: { none: "No open sepsis alarm", acknowledged: "acknowledged", snoozed: "snoozed · until {time}",
      lastAnswer: "in the last answer: {kind}" },
    type: { contact: "Contact", droplet: "Droplet", airborne: "Airborne", protective: "Protective" },
    honesty: "Not on this page: device days (central line, urinary catheter, ventilator), device utilisation, infection rates, antibiotic days and culture results — none has a source record in this system; none was computed. Defining infections and counting events is not this system's work; the system produces no threshold or definition. Homunculus does not diagnose or give orders.",
    unknown: "A state this version does not know: {state}",
  },
};
```

In `dashboard/src/live/i18n/catalog.js`, find:

```js
// G4-04: «İş yükü» — who looks after which bed this shift, and each unit's work (screens/isyuku).
import isyuku from "./strings/isyuku.js";
```

Replace with:

```js
// G4-04: «İş yükü» — who looks after which bed this shift, and each unit's work (screens/isyuku).
import isyuku from "./strings/isyuku.js";

// G4-05: «Enfeksiyon kontrol» — isolation, suspected infection, the antibiotic clock, sepsis alarms (screens/enfeksiyon).
import enfeksiyon from "./strings/enfeksiyon.js";
```

Then find:

```js
  isyuku, // G4-04
};
```

Replace with:

```js
  isyuku, // G4-04

  enfeksiyon, // G4-05
};
```

- [ ] **Step 4: Mirror the key**

In `dashboard/src/live/screens/admin/catalogue.js`, find:

```js
  // G4-04 — İş yükü (spec D2): the page and GET /shift-schedule; the default charge-nurse group holds it (migration
  // 0022), the system one by rule
  "workload.view",
]);
```

Replace with:

```js
  // G4-04 — İş yükü (spec D2): the page and GET /shift-schedule; the default charge-nurse group holds it (migration
  // 0022), the system one by rule
  "workload.view",

  // G4-05 — Enfeksiyon kontrol (spec D2, D9): the page and GET /infection; the default attending, unit-physician,
  // physician, charge-nurse and nurse groups hold it (migration 0023), the system one by rule
  "infection.view",
]);
```

In `dashboard/src/live/screens/admin/admin.testutil.js`, find:

```js
  // G4-04
  "workload.view": "Open the İş yükü page and read each unit's workload for the current shift — patients, nurses, unassigned patients, late and remaining tasks, alarms waiting — as counts, and the shift's nurse–bed assignment (GET /shift-schedule)",
});
```

Replace with:

```js
  // G4-04
  "workload.view": "Open the İş yükü page and read each unit's workload for the current shift — patients, nurses, unassigned patients, late and remaining tasks, alarms waiting — as counts, and the shift's nurse–bed assignment (GET /shift-schedule)",
  // G4-05
  "infection.view": "Open the Enfeksiyon kontrol page: per patient in one's own units — isolation, suspected infection, the antibiotic clock and open sepsis alarms — and the isolation beds, read-only (GET /infection)",
});
```

In `dashboard/src/live/i18n/strings/perms.js`, find:

```js
    workload: { view: "“İş yükü” sayfasını açar: bu nöbet için birim birim hasta, hemşire, atanmamış hasta, geciken ve kalan iş, yanıt bekleyen alarm sayılarını ve nöbetin hemşire–yatak atamasını görür" },
  },
```

Replace with:

```js
    workload: { view: "“İş yükü” sayfasını açar: bu nöbet için birim birim hasta, hemşire, atanmamış hasta, geciken ve kalan iş, yanıt bekleyen alarm sayılarını ve nöbetin hemşire–yatak atamasını görür" },
    // G4-05 — Enfeksiyon kontrol
    infection: { view: "“Enfeksiyon kontrol” sayfasını açar: kendi birimlerindeki hastaların izolasyonunu, şüpheli enfeksiyonu, antibiyotik süresini, açık sepsis alarmlarını ve izolasyon yataklarını salt okunur görür" },
  },
```

Then find:

```js
    workload: { view: "“İş yükü” səhifəsini açır: bu növbə üçün şöbə-şöbə xəstə, tibb bacısı, təyinatsız xəstə, gecikən və qalan iş, cavab gözləyən siqnal saylarını və növbənin tibb bacısı–çarpayı təyinatını görür" },
  },
```

Replace with:

```js
    workload: { view: "“İş yükü” səhifəsini açır: bu növbə üçün şöbə-şöbə xəstə, tibb bacısı, təyinatsız xəstə, gecikən və qalan iş, cavab gözləyən siqnal saylarını və növbənin tibb bacısı–çarpayı təyinatını görür" },
    // G4-05 — Enfeksiyon kontrol
    infection: { view: "“İnfeksiya nəzarəti” səhifəsini açır: öz şöbələrindəki xəstələrin izolyasiyasını, şübhəli infeksiyanı, antibiotik müddətini, açıq sepsis siqnallarını və izolyasiya çarpayılarını yalnız oxumaq üçün görür" },
  },
```

Then find:

```js
    workload: { view: "Открывает страницу «Нагрузка»: видит по отделениям на текущую смену число пациентов, медсестёр, пациентов без медсестры, просроченных и оставшихся задач, тревог без ответа и назначение медсестёр на койки" },
  },
```

Replace with:

```js
    workload: { view: "Открывает страницу «Нагрузка»: видит по отделениям на текущую смену число пациентов, медсестёр, пациентов без медсестры, просроченных и оставшихся задач, тревог без ответа и назначение медсестёр на койки" },
    // G4-05 — Enfeksiyon kontrol
    infection: { view: "Открывает страницу «Инфекционный контроль»: только для чтения видит изоляцию пациентов своих отделений, подозрение на инфекцию, срок антибиотика, открытые тревоги сепсиса и изоляционные койки" },
  },
```

Then find:

```js
    workload: { view: "Open the “Workload” page: see, unit by unit for this shift, the counts of patients, nurses, unassigned patients, late and remaining work and alarms waiting, and the shift's nurse–bed assignment" },
  },
```

Replace with:

```js
    workload: { view: "Open the “Workload” page: see, unit by unit for this shift, the counts of patients, nurses, unassigned patients, late and remaining work and alarms waiting, and the shift's nurse–bed assignment" },
    // G4-05 — Enfeksiyon kontrol
    infection: { view: "Open the “Infection control” page: see, read-only, the isolation of the patients in one's own units, suspected infection, the antibiotic clock, open sepsis alarms and the isolation beds" },
  },
```

- [ ] **Step 5: Run the strings and the mirrors to see them pass**

Run: `cd /c/tmp/g4-enfeksiyon/dashboard && npx vitest run src/live/i18n src/live/screens/admin/catalogue.test.js src/live/screens/admin/admin.testutil.test.js src/live/screens/admin/RolesTab.test.jsx`
Expected: `Test Files  16 passed (16)`, `Tests  175 passed (175)`.

- [ ] **Step 6: Commit**

```bash
cd /c/tmp/g4-enfeksiyon && git add dashboard/src/live/i18n/enfeksiyon.strings.test.js dashboard/src/live/i18n/strings/enfeksiyon.js dashboard/src/live/i18n/catalog.js dashboard/src/live/i18n/strings/perms.js dashboard/src/live/screens/admin/catalogue.js dashboard/src/live/screens/admin/admin.testutil.js && git commit -m "feat(i18n): G4-05 the enfeksiyon namespace in four languages (the spec's Turkish, the alarm kinds as criteria met, the honesty and isolation-record notes, Decision 18's reasons) and infection.view's mirrors after workload.view" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- dashboard/src/live/i18n/enfeksiyon.strings.test.js dashboard/src/live/i18n/strings/enfeksiyon.js dashboard/src/live/i18n/catalog.js dashboard/src/live/i18n/strings/perms.js dashboard/src/live/screens/admin/catalogue.js dashboard/src/live/screens/admin/admin.testutil.js
```

---

## Task 9 (dashboard): `GET /infection` in the API client and the dev proxy; the answer's clock skew in `screens/common/`

**Files:**
- Modify: `dashboard/src/backendApi.js` (`infection()` after `pharmacy()`)
- Test: `dashboard/src/backendApi.test.js` (a describe after Eczane's)
- Modify: `dashboard/src/live/session/testTokens.testutil.js` (`fakeApi`: `infection`)
- Modify: `dashboard/vite.config.js` (the proxy list)
- Create: `dashboard/src/live/screens/common/skewAtReceipt.js`
- Modify: `dashboard/src/live/screens/eczane/usePharmacy.js` (imports `skewAtReceipt` from there; its own copy and `msOf` import go — §5 M9)

`usePharmacy.test.jsx` is not touched: it pins the moved function through the hook, and must pass unchanged.

- [ ] **Step 1: Write the failing client test**

In `dashboard/src/backendApi.test.js`, find:

```js
    expect(url).toBe("/pharmacy");
    expect(init.method || "GET").toBe("GET");
    expect(init.body).toBeUndefined();
    expect(init.headers.Authorization).toBe("Bearer acc-1");
  });
});
```

Replace with:

```js
    expect(url).toBe("/pharmacy");
    expect(init.method || "GET").toBe("GET");
    expect(init.body).toBeUndefined();
    expect(init.headers.Authorization).toBe("Bearer acc-1");
  });
});

// G4-05 — Enfeksiyon kontrol: the infection-control page, built by the engine (homunculus/api/infection.py)
describe("G4-05 Enfeksiyon kontrol call", () => {
  it("reads the ward's infection-control list with an authed GET /infection, with nothing on the address", async () => {
    store.set("homunculus-access-token", "acc-1");
    store.set("homunculus-refresh-token", "ref-1");
    const answer = { now: "2026-11-12T09:30:00+00:00", counts: { patients: 0 }, units: [], isolated: [], suspected: [],
      bed_occupants: [], scope: { unrestricted: true }, scope_note: null };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(answer));
    const api = createBackendApi({ baseUrl: "", fetchImpl: fetchMock });
    expect(await api.infection()).toEqual(answer);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/infection");
    expect(init.method || "GET").toBe("GET");
    expect(init.body).toBeUndefined();
    expect(init.headers.Authorization).toBe("Bearer acc-1");
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd /c/tmp/g4-enfeksiyon/dashboard && npx vitest run src/backendApi.test.js`
Expected: `Tests  1 failed | 152 passed (153)` — «reads the ward's infection-control list with an authed GET /infection, with nothing on the address» (the client has no `infection` yet).

- [ ] **Step 3: Add the call, its mock and the dev proxy**

In `dashboard/src/backendApi.js`, find:

```js
    pharmacy() {
      return authed("/pharmacy");
    },
```

Replace with:

```js
    pharmacy() {
      return authed("/pharmacy");
    },

    /**
     * G4-05 «Enfeksiyon kontrol» (GET /infection, `infection.view`): one row per patient of the caller's scoped board
     * who is in isolation, or has suspected infection or a Sepsis-3 alarm — with Eczane's antibiotic state — who lies on
     * each bed, and the counts, whole and per unit (api/infection.py): {now, antibiotic_window_min,
     * antibiotic_window_source, counts, units, isolated, suspected, bed_occupants, scope, scope_note}. No parameter:
     * nothing goes on the address. The isolation beds are drawn from GET /tenant/structure, not from this answer.
     */
    infection() {
      return authed("/infection");
    },
```

In `dashboard/src/live/session/testTokens.testutil.js`, find:

```js
    // G3-04: Eczane — the pharmacist's ward page (screens/eczane)
    pharmacy: vi.fn(),
```

Replace with:

```js
    // G3-04: Eczane — the pharmacist's ward page (screens/eczane)
    pharmacy: vi.fn(),

    // G4-05: Enfeksiyon kontrol — the infection-control page (screens/enfeksiyon)
    infection: vi.fn(),
```

In `dashboard/vite.config.js`, find:

```js
      "/quality",           // G4-03: Kalite göstergeleri — GET /quality
```

Replace with:

```js
      "/quality",           // G4-03: Kalite göstergeleri — GET /quality
      "/infection",         // G4-05: Enfeksiyon kontrol — GET /infection
```

- [ ] **Step 4: Move the answer's clock skew to `screens/common/`**

Create `dashboard/src/live/screens/common/skewAtReceipt.js` with:

```js
// src/live/screens/common/skewAtReceipt.js — the clock skew of a page's own answer (server minus browser, ms), taken the
// moment the answer lands. Written for «Eczane» (G3-04, eczane/usePharmacy.js) and moved here unchanged when «Enfeksiyon
// kontrol» (G4-05, spec §5 M9) came to read its own answers the same way: two copies of one rule would drift.
//
// A page whose session holds no `board.view` has no board store, so no board skew; its clock is corrected by this one
// (pharmacyModel `clockSkewOf`), so a workstation whose clock is wrong neither reads a dead list as fresh nor a live
// one as stale.

/** backendApi's own floor for a measured skew: under it the honest answer is 0. */
export const SKEW_NOISE_MS = 2_000;

/** Server minus browser, in ms, at the moment `answer` landed; null when neither the client nor the answer says.
 *  The answer's own `now` is read the way the client reads the `Date` header (backendApi `noteServerDate`): the
 *  route stamped it before the answer travelled, so a right clock measures minus the latency — under the noise
 *  floor that is 0, and above it the figure is rounded to the second. Injected raw, the jitter would move the
 *  instant every duration is counted against on every answer, and a minute would flicker at its boundary. */
export function skewAtReceipt(api, answer) {
  const measured = typeof api?.serverClockSkewMs === "function" ? api.serverClockSkewMs() : null;
  if (Number.isFinite(measured)) return measured;
  const at = typeof answer?.now === "string" ? Date.parse(answer.now) : Number.NaN;
  if (!Number.isFinite(at)) return null;
  const raw = at - Date.now();
  return Math.abs(raw) < SKEW_NOISE_MS ? 0 : Math.round(raw / 1000) * 1000;
}
```

In `dashboard/src/live/screens/eczane/usePharmacy.js`, find:

```js
import { useCallback, useEffect, useRef, useState } from "react";
import { msOf } from "./pharmacyModel.js";
```

Replace with:

```js
import { useCallback, useEffect, useRef, useState } from "react";
import { skewAtReceipt } from "../common/skewAtReceipt.js";   // G4-05 (spec §5 M9): moved there, unchanged
```

Then find:

```js
/** backendApi's own floor for a measured skew: under it the honest answer is 0. */
const SKEW_NOISE_MS = 2_000;

/** Server minus browser, in ms, at the moment `answer` landed; null when neither the client nor the answer says.
 *  The answer's own `now` is read the way the client reads the `Date` header (backendApi `noteServerDate`): the
 *  route stamped it before the answer travelled, so a right clock measures minus the latency — under the noise
 *  floor that is 0, and above it the figure is rounded to the second. Injected raw, the jitter would move the
 *  instant every duration is counted against on every answer, and a minute would flicker at its boundary. */
function skewAtReceipt(api, answer) {
  const measured = typeof api?.serverClockSkewMs === "function" ? api.serverClockSkewMs() : null;
  if (Number.isFinite(measured)) return measured;
  const at = msOf(answer.now);
  if (at === null) return null;
  const raw = at - Date.now();
  return Math.abs(raw) < SKEW_NOISE_MS ? 0 : Math.round(raw / 1000) * 1000;
}

export function usePharmacy(store, { everyMs = PHARMACY_TICK_MS } = {}) {
```

Replace with:

```js
export function usePharmacy(store, { everyMs = PHARMACY_TICK_MS } = {}) {
```

- [ ] **Step 5: Run the client, the pharmacy hook and the proxy tests**

Run: `cd /c/tmp/g4-enfeksiyon/dashboard && npx vitest run src/backendApi.test.js src/live/screens/eczane src/devProxy.test.js`
Expected: `Test Files  5 passed (5)`, `Tests  247 passed (247)`. `devProxy.test.js` checks that the dev proxy covers every path nginx proxies, not the other way round: it is red only while the engine's Task 6 is in and this step is not (N12).

- [ ] **Step 6: Commit**

```bash
cd /c/tmp/g4-enfeksiyon && git add dashboard/src/backendApi.js dashboard/src/backendApi.test.js dashboard/src/live/session/testTokens.testutil.js dashboard/vite.config.js dashboard/src/live/screens/common/skewAtReceipt.js dashboard/src/live/screens/eczane/usePharmacy.js && git commit -m "feat(api): G4-05 GET /infection in the API client, the fake API and the dev proxy; the answer's clock skew moves to screens/common/skewAtReceipt.js, usePharmacy imports it (spec §5 M9)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- dashboard/src/backendApi.js dashboard/src/backendApi.test.js dashboard/src/live/session/testTokens.testutil.js dashboard/vite.config.js dashboard/src/live/screens/common/skewAtReceipt.js dashboard/src/live/screens/eczane/usePharmacy.js
```

---

## Task 10 (dashboard): `useInfection` — Eczane's tempo, its own hook, the tree read with it; the synthetic ward

**Files:**
- Create: `dashboard/src/live/screens/enfeksiyon/enfeksiyon.testutil.js`
- Create: `dashboard/src/live/screens/enfeksiyon/useInfection.js`
- Test: `dashboard/src/live/screens/enfeksiyon/useInfection.test.jsx` (new)

- [ ] **Step 1: Write the synthetic ward**

Create `dashboard/src/live/screens/enfeksiyon/enfeksiyon.testutil.js` with:

```js
// Test-only: a synthetic ward for «Enfeksiyon kontrol» (G4-05) — the kabul ward (Reanimasiya open, Neonatal closed)
// with an isolation room whose beds stand in every tile state, and GET /infection's answer in the shape the engine sends
// after spec §5: four patients in isolation (one in the isolation room, one outside it, one on a bed the structure
// calls free, one on no bed), four with suspected infection or a Sepsis-3 alarm (a missed clock with a firing septic
// shock, a running clock, a latched septic shock after the mark was charted 0), and who lies on each bed. The two lists
// come in the SERVER'S order (by patient key), which the page re-orders by name. Synthetic names and keys only
// (CLAUDE.md rule 6).
import { NOW } from "../../data/board.testutil.js";
import { BED, NEO, REA, ROOM1, SITE, T } from "../kabul/kabul.testutil.js";

export { BED, NEO, NOW, REA };
export const MIN = 60_000;
/** An ISO instant this many minutes before NOW (negative: after it). */
export const at = (minutesAgo) => new Date(NOW - minutesAgo * MIN).toISOString();
export const ISO_ROOM = "44444444-4444-4444-8444-444444444411";
export const ISO_ROOM_CLOSED = "44444444-4444-4444-8444-444444444412";
const NEO_ROOM = "44444444-4444-4444-8444-444444444413";

const bed = (n, label, state = "AVAILABLE", isActive = true) => ({ id: BED(n), label, state, is_active: isActive,
  state_since: at(60) });

/** GET /tenant/structure. Reanimasiya: «Otaq 1» (not an isolation room: beds 1 and 2 occupied, 3 free) and
 *  «İzolasyon 1» — beds İzo 1 … İzo 10 in every tile state, İzo 11 closed; «İzolasyon 2», a closed isolation room;
 *  Neonatal, a closed unit with an isolation room. `isolation: false` makes every room an ordinary one. */
export function tree({ isolation = true } = {}) {
  return {
    tenant_id: T,
    sites: [{ id: SITE, name: "Ana bina", is_active: true, units: [
      { id: REA, name: "Reanimasiya", unit_type: "ADULT_ICU", is_active: true, rooms: [
        { id: ROOM1, name: "Otaq 1", room_number: null, is_isolation: false, is_active: true,
          beds: [bed(1, "1", "OCCUPIED"), bed(2, "2", "OCCUPIED"), bed(3, "3", "OCCUPIED")] },
        { id: ISO_ROOM, name: "İzolasyon 1", room_number: null, is_isolation: isolation, is_active: true, beds: [
          bed(11, "İzo 1", "OCCUPIED"),             // Ayşe, in isolation                     → isolated
          bed(12, "İzo 2"),                         //                                        → free
          bed(13, "İzo 3", "OCCUPIED"),             // her patient is outside this list       → occupant_unseen
          bed(14, "İzo 4", "HOUSEKEEPING"),         //                                        → cleaning
          bed(15, "İzo 5", "RESERVED"),             //                                        → reserved
          bed(16, "İzo 6", "BLOCKED"),              //                                        → out_of_service
          bed(17, "İzo 7", "MAINTENANCE"),          //                                        → maintenance
          bed(18, "İzo 8", "PENDING_DISCHARGE"),    // Nigar, not in isolation                → not_isolated
          bed(19, "İzo 9", "OCCUPIED"),             // Leyla, nothing recorded                → unrecorded
          bed(20, "İzo 10"),                        // Kamran, placed by the HIS bed map      → conflict
          bed(21, "İzo 11", "AVAILABLE", false),    // closed: not drawn
        ] },
        { id: ISO_ROOM_CLOSED, name: "İzolasyon 2", room_number: null, is_isolation: isolation, is_active: false,
          beds: [bed(22, "İzo 12")] },
      ] },
      { id: NEO, name: "Neonatal", unit_type: "NICU", is_active: false, rooms: [
        { id: NEO_ROOM, name: "N-1", room_number: null, is_isolation: isolation, is_active: true, beds: [bed(6, "N1")] },
      ] },
    ] }],
  };
}

const NO_CLOCK = Object.freeze({ state: "none", given: null, given_at: null, recognized_at: null, deadline: null,
  remaining_sec: null });
/** A row's `isolation` (api/infection.py `isolation_of`). */
export const iso = (state, types = [], chartedAt = at(80)) => ({ state, types,
  charted_at: state === "unrecorded" ? null : chartedAt });
/** One of a row's `sepsis_alarms`; `over` replaces whole fields. */
export const alarmOf = (kind, severity, over = {}) => ({ kind, severity, first_seen_at: at(70), resolved_at: null,
  acknowledged: false, snooze_until: null, ...over });

/** One row; `over` replaces whole fields. */
export const row = (patientId, over = {}) => ({
  patient_id: patientId, bed_label: "", bed_id: null, unit_id: REA, display_name: "", isolation: iso("unrecorded"),
  suspected_infection: null, antibiotic: { ...NO_CLOCK }, sepsis_alarms: [], sort_group: 2, ...over,
});

export const AYSE = row("S-101", { bed_label: "İzo 1", bed_id: BED(11), display_name: "Ayşe Sentetik",
  isolation: iso("isolated", ["contact", "droplet"]), suspected_infection: true,
  antibiotic: { state: "met", given: true, given_at: at(170), recognized_at: at(210), deadline: at(150), remaining_sec: null } });
// Its deadline is half a minute off the whole minute (NOW + 20:30), so «20 dəq qalıb» holds whether the screen's clock
// stands on NOW or a few milliseconds past it (Eczane's fixture does the same).
export const ELIF = row("S-102", { bed_label: "3", bed_id: BED(3), display_name: "Elif Sentetik", suspected_infection: true,
  antibiotic: { state: "running", given: null, given_at: null, recognized_at: at(39.5), deadline: at(-20.5), remaining_sec: 1230 },
  sort_group: 0 });
export const ALI = row("S-103", { bed_label: "2", bed_id: BED(2), display_name: "Ali Sentetik", suspected_infection: true,
  antibiotic: { state: "missed", given: null, given_at: null, recognized_at: at(85), deadline: at(25), remaining_sec: -1500 },
  sepsis_alarms: [alarmOf("septic_shock", "critical")], sort_group: 0 });
/** In isolation outside an isolation room; the HIS has sent no name. */
export const UNNAMED = row("S-104", { bed_label: "1", bed_id: BED(1), isolation: iso("isolated", ["airborne"], at(700)) });
/** In isolation, on no bed and no unit (the bed table does not place her HIS location). */
export const MURAD = row("S-105", { unit_id: null, display_name: "Murad Sentetik", isolation: iso("isolated", ["protective"]) });
export const NIGAR = row("S-106", { bed_label: "İzo 8", bed_id: BED(18), display_name: "Nigar Sentetik",
  isolation: iso("not_isolated") });
/** A septic shock that stopped while nobody acknowledged it, after suspected infection was charted 0 (§5 M3). */
export const LEYLA = row("S-107", { bed_label: "İzo 9", bed_id: BED(19), display_name: "Leyla Sentetik",
  suspected_infection: false, sepsis_alarms: [alarmOf("septic_shock", "critical", { resolved_at: at(15) })] });
/** In isolation on a bed the structure calls free: the HIS bed map placed her there (§5 A4 a). */
export const KAMRAN = row("S-108", { bed_label: "İzo 10", bed_id: BED(20), display_name: "Kamran Sentetik",
  isolation: iso("isolated", ["airborne"]) });

/** The two lists as the server sends them: by patient key. */
export const ISOLATED = [AYSE, UNNAMED, MURAD, KAMRAN];
export const SUSPECTED = [AYSE, ELIF, ALI, LEYLA];
export const ROWS = [AYSE, ELIF, ALI, UNNAMED, MURAD, NIGAR, LEYLA, KAMRAN];
/** A row as `bed_occupants` carries it. */
export const occupantOf = (r) => ({ bed_id: r.bed_id, patient_id: r.patient_id, display_name: r.display_name,
  isolation: { state: r.isolation.state, types: [...r.isolation.types] } });
export const COUNTS = { patients: 8, isolated: 4, isolation_unrecorded: 3, suspected: 3, suspected_unrecorded: 4,
  clock_missed: 1, sepsis_open: 1 };
export const REA_COUNTS = { patients: 7, isolated: 3, isolation_unrecorded: 3, suspected: 3, suspected_unrecorded: 3,
  clock_missed: 1, sepsis_open: 1 };
export const SCOPE = { unrestricted: false, reason: "assigned", unit_ids: [REA], bed_ids: [], own_patients: 0, hidden: 0,
  unresolved_hidden: 0, unmatched_unit_ids: [], unmatched_bed_ids: [], blind: false };

/** GET /infection; `over` replaces whole top-level fields. */
export const answer = (over = {}) => ({
  now: at(0), antibiotic_window_min: 60, antibiotic_window_source: "surviving-sepsis-campaign-2026",
  counts: { ...COUNTS }, units: [{ unit_id: REA, counts: { ...REA_COUNTS } }],
  isolated: ISOLATED, suspected: SUSPECTED, bed_occupants: ROWS.filter((r) => r.bed_id).map(occupantOf),
  scope: SCOPE, scope_note: null, ...over,
});
```

- [ ] **Step 2: Write the failing hook test**

Create `dashboard/src/live/screens/enfeksiyon/useInfection.test.jsx` with:

```js
// useInfection.test.jsx — «Enfeksiyon kontrol» (G4-05, spec D14 as §5 M9 and S1 amend it): the page's own read, with
// usePharmacy's rules — on mount and every 30 s, nothing from a hidden tab and a read when it is shown, the sequence
// guard, a refused read drops the held answer and any other failure keeps it, a malformed answer is a failed read, the
// skew of each answer — and the structure tree read with it, for a session that may read the tree.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { PHARMACY_TICK_MS } from "../eczane/usePharmacy.js";
import { INFECTION_TICK_MS, isInfectionAnswer, useInfection } from "./useInfection.js";
import { MIN, NOW, answer } from "./enfeksiyon.testutil.js";

const settle = () => new Promise((resolve) => { setTimeout(resolve, 0); });
const pass = (ms) => act(async () => { vi.advanceTimersByTime(ms); await settle(); });
const storeWith = (infection, api = {}) => ({ track: (call) => call(), api: { infection, ...api } });
async function mountHook(infection, { api, reloadStructure } = {}) {
  const store = storeWith(infection, api);
  const rendered = renderHook(() => useInfection(store, { reloadStructure }));
  await act(async () => { await settle(); });
  return rendered;
}

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); });
afterEach(() => { vi.useRealTimers(); });

describe("useInfection", () => {
  it("reads on mount and every 30 s — Eczane's tempo", async () => {
    const infection = vi.fn().mockResolvedValue(answer());
    const { result } = await mountHook(infection);
    expect(INFECTION_TICK_MS).toBe(PHARMACY_TICK_MS);
    expect(INFECTION_TICK_MS).toBe(30_000);
    expect(infection).toHaveBeenCalledTimes(1);
    expect(result.current.data).toEqual(answer());
    expect(result.current.error).toBeNull();
    await pass(29_000);
    expect(infection).toHaveBeenCalledTimes(1);
    await pass(1_000);
    expect(infection).toHaveBeenCalledTimes(2);
  });

  it("keeps the last answer and reports the error when a read fails, and clears the error when one lands", async () => {
    const infection = vi.fn().mockResolvedValue(answer());
    const { result } = await mountHook(infection);
    const failure = Object.assign(new Error("kapsam şu anda okunamıyor"), { status: 503 });
    infection.mockRejectedValueOnce(failure);
    await pass(30_000);
    expect(result.current.data).toEqual(answer());
    expect(result.current.error).toBe(failure);
    await pass(30_000);
    expect(result.current.error).toBeNull();
  });

  it("drops the held answer when the read is refused, and keeps it through a 5xx, a timeout and a network failure", async () => {
    for (const [failure, kept] of [
      [Object.assign(new Error("permission required: infection.view"), { status: 403 }), false],
      [Object.assign(new Error("unknown credential"), { status: 401 }), false],
      [Object.assign(new Error("boom"), { status: 500 }), true],
      [Object.assign(new Error("zaman aşımı"), { code: "REQUEST_TIMEOUT" }), true],
      [new TypeError("Failed to fetch"), true],
    ]) {
      const infection = vi.fn().mockResolvedValue(answer());
      // eslint-disable-next-line no-await-in-loop
      const { result, unmount } = await mountHook(infection);
      infection.mockRejectedValueOnce(failure);
      // eslint-disable-next-line no-await-in-loop
      await pass(30_000);
      expect(result.current.data, failure.message).toEqual(kept ? answer() : null);
      expect(result.current.error, failure.message).toBe(failure);
      unmount();
    }
  });

  it("takes an answer of another shape for a failed read, never for an empty ward (§5 M9)", async () => {
    const whole = answer();
    const bad = [undefined, null, {}, { rows: [] }, { ...whole, counts: null }, { ...whole, counts: [] },
      { ...whole, isolated: null }, { ...whole, suspected: "none" }, { ...whole, bed_occupants: undefined },
      { ...whole, units: {} }];
    for (const value of bad) {
      expect(isInfectionAnswer(value), JSON.stringify(value)?.slice(0, 60)).toBe(false);
      // eslint-disable-next-line no-await-in-loop
      const { result, unmount } = await mountHook(vi.fn().mockResolvedValue(value));
      expect(result.current.data).toBeNull();
      expect(result.current.error?.malformed).toBe(true);
      unmount();
    }
    expect(isInfectionAnswer(answer({ isolated: [], suspected: [], bed_occupants: [], units: [] }))).toBe(true);
  });

  it("drops the answer to an earlier read that lands after a newer one", async () => {
    let releaseSlow;
    const slow = new Promise((resolve) => { releaseSlow = resolve; });
    const newer = answer({ isolated: [] });
    const infection = vi.fn().mockReturnValueOnce(slow).mockResolvedValue(newer);
    const { result } = await mountHook(infection);
    await pass(30_000);
    expect(result.current.data).toEqual(newer);
    await act(async () => { releaseSlow(answer()); await settle(); });
    expect(result.current.data).toEqual(newer);
  });

  it("reads nothing from a hidden tab, at once when it is shown again, and nothing after the page is left", async () => {
    const infection = vi.fn().mockResolvedValue(answer());
    const { unmount } = await mountHook(infection);
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    try {
      await pass(95_000);
      expect(infection).toHaveBeenCalledTimes(1);
      visibility.mockReturnValue("visible");
      await act(async () => { document.dispatchEvent(new Event("visibilitychange")); await settle(); });
      expect(infection).toHaveBeenCalledTimes(2);
    } finally {
      visibility.mockRestore();
    }
    unmount();
    await pass(90_000);
    expect(infection).toHaveBeenCalledTimes(2);
  });

  it("`refresh` reads again on request", async () => {
    const infection = vi.fn().mockResolvedValue(answer());
    const { result } = await mountHook(infection);
    await act(async () => { await result.current.refresh(); });
    expect(infection).toHaveBeenCalledTimes(2);
  });

  it("takes each answer's clock skew: the client's measure, else the answer's own `now`", async () => {
    const { result, unmount } = await mountHook(vi.fn().mockResolvedValue(answer()), { api: { serverClockSkewMs: () => 300_000 } });
    expect(result.current.skewMs).toBe(300_000);
    unmount();
    vi.setSystemTime(NOW - 5 * MIN);                                  // the workstation five minutes slow
    const slow = await mountHook(vi.fn().mockResolvedValue(answer()));
    expect(Math.abs(slow.result.current.skewMs - 5 * MIN)).toBeLessThan(1_000);
  });
});

// §5 S1: the isolation beds are the structure tree's; the tree is read again with each read of the list.
describe("the structure tree, read with the list", () => {
  it("is read on mount and with every tick, never from a hidden tab", async () => {
    const reloadStructure = vi.fn().mockResolvedValue({ sites: [] });
    const infection = vi.fn().mockResolvedValue(answer());
    await mountHook(infection, { reloadStructure });
    expect(reloadStructure).toHaveBeenCalledTimes(1);
    await pass(30_000);
    expect(reloadStructure).toHaveBeenCalledTimes(2);
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    try {
      await pass(60_000);
      expect(reloadStructure).toHaveBeenCalledTimes(2);
    } finally {
      visibility.mockRestore();
    }
  });

  it("does not hold the list back when the tree's read fails", async () => {
    const reloadStructure = vi.fn().mockRejectedValue(new Error("down"));
    const { result } = await mountHook(vi.fn().mockResolvedValue(answer()), { reloadStructure });
    expect(result.current.data).toEqual(answer());
    expect(result.current.error).toBeNull();
  });

  it("is not read for a session that may not read it (no reload given)", async () => {
    const infection = vi.fn().mockResolvedValue(answer());
    const { result } = await mountHook(infection);
    await pass(30_000);
    expect(infection).toHaveBeenCalledTimes(2);
    expect(result.current.data).toEqual(answer());
  });
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `cd /c/tmp/g4-enfeksiyon/dashboard && npx vitest run src/live/screens/enfeksiyon/useInfection.test.jsx`
Expected: the file fails to load — `Failed to resolve import "./useInfection.js"` — `Test Files  1 failed (1)`, no test run.

- [ ] **Step 4: Write the hook**

Create `dashboard/src/live/screens/enfeksiyon/useInfection.js` with:

```js
// src/live/screens/enfeksiyon/useInfection.js — «Enfeksiyon kontrol» (G4-05, spec D14 as §5 M9 and S1 amend it): the
// page's own read, GET /infection, on mount and every 30 s — Eczane's tempo (usePharmacy.js), whose running antibiotic
// clocks and alarm states this page shows too. Its own small hook with usePharmacy's rules, not a shared one (§5 M9):
//   - nothing is read from a hidden tab; the tab shown again reads at once;
//   - the sequence guard: the answer to an earlier read never lands over a newer one;
//   - a 401 or a 403 drops the held answer (the right was withdrawn, the session is gone); a 5xx, a timeout or a
//     network failure keeps it, and the page says it is not current;
//   - an answer of another shape — `counts` not an object; `isolated`, `suspected`, `bed_occupants` or `units` not
//     arrays — is a failed read (`error.malformed`), never an empty ward;
//   - the clock skew of each answer, taken as it lands (common/skewAtReceipt.js, usePharmacy's own rule).
// And one thing usePharmacy does not do (§5 S1): with each read it asks the shell's structure tree to be read again
// (`reloadStructure`: StructureProvider's `reload`, as useSummaryReads does), so the isolation beds the page draws from
// the tree are as fresh as the list. The page passes it only to a session that may read the tree (STRUCTURE_PERMS); it
// reads the tree's state itself (ozet.js `structureSource`). A tree that fails to read never holds the list back.
import { useCallback, useEffect, useRef, useState } from "react";
import { PHARMACY_TICK_MS } from "../eczane/usePharmacy.js";
import { skewAtReceipt } from "../common/skewAtReceipt.js";

/** Eczane's 30 s (spec D14): the same clocks, read at the same tempo. */
export const INFECTION_TICK_MS = PHARMACY_TICK_MS;

const hidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";
const malformed = () => Object.assign(new Error(""), { malformed: true });
/** The caller is no longer allowed to see the list (as `apiErrors.js` reads a refusal: by its status). */
const refused = (error) => error?.status === 401 || error?.status === 403;
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/** GET /infection as this page reads it (§5 M9); anything else is a failed read. */
export function isInfectionAnswer(answer) {
  return isObject(answer) && isObject(answer.counts) && Array.isArray(answer.isolated)
    && Array.isArray(answer.suspected) && Array.isArray(answer.bed_occupants) && Array.isArray(answer.units);
}

export function useInfection(store, { reloadStructure = null, everyMs = INFECTION_TICK_MS } = {}) {
  const [state, setState] = useState({ data: null, error: null, skewMs: null });
  const alive = useRef(true);
  //: the sequence of the latest read issued; an answer to an earlier one is dropped
  const seq = useRef(0);
  const read = useCallback(async () => {
    const mine = ++seq.current;
    if (reloadStructure) Promise.resolve(reloadStructure()).catch(() => {});
    try {
      const data = await store.track(() => store.api.infection());
      if (!isInfectionAnswer(data)) throw malformed();
      const skewMs = skewAtReceipt(store.api, data);
      if (alive.current && mine === seq.current) setState({ data, error: null, skewMs });
    } catch (error) {
      if (alive.current && mine === seq.current) {
        setState((s) => ({ data: refused(error) ? null : s.data, error, skewMs: s.skewMs }));
      }
    }
  }, [store, reloadStructure]);
  useEffect(() => {
    alive.current = true;
    read();
    const wake = () => { if (!hidden()) read(); };
    const id = setInterval(wake, everyMs);
    document.addEventListener("visibilitychange", wake);
    return () => {
      alive.current = false;
      clearInterval(id);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [read, everyMs]);
  return { data: state.data, error: state.error, skewMs: state.skewMs, refresh: read };
}
```

- [ ] **Step 5: Run it to see it pass**

Run: `cd /c/tmp/g4-enfeksiyon/dashboard && npx vitest run src/live/screens/enfeksiyon/useInfection.test.jsx src/live/screens/eczane/usePharmacy.test.jsx`
Expected: `Test Files  2 passed (2)`, `Tests  30 passed (30)` (usePharmacy's 19 unchanged).

- [ ] **Step 6: Commit**

```bash
cd /c/tmp/g4-enfeksiyon && git add dashboard/src/live/screens/enfeksiyon/enfeksiyon.testutil.js dashboard/src/live/screens/enfeksiyon/useInfection.js dashboard/src/live/screens/enfeksiyon/useInfection.test.jsx && git commit -m "feat(enfeksiyon): G4-05 useInfection — GET /infection every 30 s with usePharmacy's rules (hidden tab, sequence guard, a refusal drops the answer, a malformed one fails, the answer's skew) and the structure tree read with it; the synthetic ward" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- dashboard/src/live/screens/enfeksiyon/enfeksiyon.testutil.js dashboard/src/live/screens/enfeksiyon/useInfection.js dashboard/src/live/screens/enfeksiyon/useInfection.test.jsx
```

---

## Task 11 (dashboard): the pure `enfeksiyon.js` — the isolation beds from the tree, the selection, the order, Decision 18 per cell

**Files:**
- Modify: `dashboard/src/live/data/structure.js` (`indexStructure`: `isIsolation` on rooms and beds)
- Test: `dashboard/src/live/data/structure.test.js` (the import; a test in the index's block)
- Create: `dashboard/src/live/screens/enfeksiyon/enfeksiyon.js`
- Test: `dashboard/src/live/screens/enfeksiyon/enfeksiyon.test.js` (new)

The spec calls this module `infectionModel.js`; it is named after its folder, as `isyuku/isyuku.js` and `ozet/ozet.js` are (plan note N14).

- [ ] **Step 1: Write the failing tests**

In `dashboard/src/live/data/structure.test.js`, find:

```js
import { BED, NEO, REA, structure } from "../screens/kabul/kabul.testutil.js";
```

Replace with:

```js
import { BED, NEO, REA, ROOM2, structure } from "../screens/kabul/kabul.testutil.js";
```

Then find:

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

  // G4-05 (spec §5 S1): whether a room isolates, on the room and on each of its beds — «Enfeksiyon kontrol» words its
  // «Oda» cells from it.
  it("says whether a room is an isolation room, on the room and on its beds", () => {
    const tree = structure();
    tree.sites[0].units[0].rooms[1].is_isolation = true;
    const isolating = indexStructure(tree);
    expect(isolating.rooms.get(ROOM2).isIsolation).toBe(true);
    expect(isolating.beds.get(BED(5)).isIsolation).toBe(true);
    expect(isolating.beds.get(BED(1)).isIsolation).toBe(false);
    expect(index.rooms.get(ROOM2).isIsolation).toBe(false);
  });
});
```

Create `dashboard/src/live/screens/enfeksiyon/enfeksiyon.test.js` with:

```js
// enfeksiyon.test.js — «Enfeksiyon kontrol» (G4-05, spec D10–D15 as §5 S1, A3, A4, M3, M4 amend them), pure: the
// isolation beds drawn from the tree — every tile state, a closed bed, room or unit not drawn, the tally — the unit
// selection (a no-unit row only under «Tüm birimler», a unit an answer does not list counts 0), both orders by name,
// the «Birim» and «Oda» cells, and Decision 18 for the counts, the tiles and the alarm cell.
import { describe, it, expect } from "vitest";
import { indexStructure } from "../../data/structure.js";
import {
  ALL, TILES, alarmItems, bedTally, countCell, freeBedsCell, isolationBeds, roomCell, selectionOf, sortRows, tileOf,
  tileWords, unitChoices, unitOf,
} from "./enfeksiyon.js";
import {
  ALI, AYSE, BED, ELIF, KAMRAN, LEYLA, MURAD, NEO, NIGAR, REA, REA_COUNTS, UNNAMED, answer, at, row, tree,
} from "./enfeksiyon.testutil.js";

const ids = (rows) => rows.map((r) => r.patient_id);
const NAMES = new Map([[REA, "Reanimasiya"], [NEO, "Neonatal"], ["u-a", "A birimi"]]);
const order = (over = {}) => ({ unitOf: (r) => unitOf(r, indexStructure(tree())), unitName: (id) => NAMES.get(id) ?? id,
  lang: "tr", ...over });

describe("the isolation beds, from the tree (§5 S1, A4)", () => {
  const tiles = isolationBeds(tree(), answer());
  const byLabel = Object.fromEntries(tiles.map((tile) => [tile.label, tile]));

  it("draws every open bed of an open isolation room of an open unit, in the tree's order", () => {
    expect(tiles.map((tile) => tile.label)).toEqual(["İzo 1", "İzo 2", "İzo 3", "İzo 4", "İzo 5", "İzo 6", "İzo 7",
      "İzo 8", "İzo 9", "İzo 10"]);                    // İzo 11 is closed; İzolasyon 2 is closed; Neonatal is closed
    expect(byLabel["İzo 1"]).toMatchObject({ roomName: "İzolasyon 1", unitId: REA, state: "OCCUPIED" });
  });

  it("decides each tile from the tree's state and who lies on the bed", () => {
    expect(Object.fromEntries(tiles.map((tile) => [tile.label, tile.tile]))).toEqual({
      "İzo 1": "isolated", "İzo 2": "free", "İzo 3": "occupant_unseen", "İzo 4": "cleaning", "İzo 5": "reserved",
      "İzo 6": "out_of_service", "İzo 7": "maintenance", "İzo 8": "not_isolated", "İzo 9": "unrecorded",
      "İzo 10": "conflict" });
    expect(byLabel["İzo 1"].occupants).toEqual([{ patient_id: "S-101", display_name: "Ayşe Sentetik", state: "isolated",
      types: ["contact", "droplet"] }]);
    expect(byLabel["İzo 10"].occupants.map((o) => o.patient_id)).toEqual(["S-108"]);
  });

  it("calls a bed with two patients isolated when one is, and an occupied bed of unknown occupants by its own word", () => {
    const two = [{ state: "not_isolated", types: [] }, { state: "isolated", types: ["contact"] }];
    expect(tileOf("OCCUPIED", two)).toBe("isolated");
    expect(tileOf("OCCUPIED", [{ state: "not_isolated", types: [] }, { state: "unrecorded", types: [] }])).toBe("unrecorded");
    expect(tileOf("PENDING_TRANSFER_OUT", [{ state: "not_isolated", types: [] }])).toBe("not_isolated");
    expect(tileOf("OCCUPIED", [{ state: "quarantine", types: [] }])).toBe("unknown");
    expect(tileOf("BLOCKED", [{ state: "isolated", types: [] }])).toBe("conflict");      // never «kullanım dışı» over a patient
    expect(tileOf("NEW_STATE", [])).toBe("unknown");
    expect(TILES).not.toContain("unknown");
  });

  it("counts the tiles: free ones, and those whose bed state has a patient — a conflict is in neither", () => {
    expect(bedTally(tiles)).toEqual({ total: 10, free: 1, occupied: 4 });
    expect(bedTally([])).toEqual({ total: 0, free: 0, occupied: 0 });
  });

  it("draws no tile when no room isolates, and none from a tree that is not one", () => {
    expect(isolationBeds(tree({ isolation: false }), answer())).toEqual([]);
    expect(isolationBeds(null, answer())).toEqual([]);
    expect(isolationBeds(tree(), null).map((tile) => tile.tile)).toContain("occupant_unseen");
  });
});

describe("the unit selection (spec D13 item 1, §5 S1, M4)", () => {
  it("offers the tree's open units and the units of the answer, each once", () => {
    expect(unitChoices(tree(), answer({ units: [{ unit_id: "u-a", counts: {} }] }))).toEqual([REA, "u-a"]);
    expect(unitChoices(null, answer())).toEqual([REA]);
    expect(unitChoices(tree(), null)).toEqual([REA]);                     // Neonatal is closed
  });

  it("takes the whole answer for «Tüm birimler», and a unit's own counts and rows for one unit", () => {
    const all = selectionOf(answer(), ALL);
    expect(all.counts).toEqual(answer().counts);
    expect(ids(all.isolated)).toEqual(["S-101", "S-104", "S-105", "S-108"]);
    const rea = selectionOf(answer(), REA);
    expect(rea.counts).toEqual(REA_COUNTS);
    expect(ids(rea.isolated)).toEqual(["S-101", "S-104", "S-108"]);      // the no-unit row is under «Tüm birimler» only
    expect(ids(rea.suspected)).toEqual(["S-101", "S-102", "S-103", "S-107"]);
  });

  it("counts 0 for a unit the answer does not list: it has no scoped card", () => {
    expect(selectionOf(answer(), "u-a").counts).toEqual({ patients: 0, isolated: 0, isolation_unrecorded: 0,
      suspected: 0, suspected_unrecorded: 0, clock_missed: 0, sepsis_open: 0 });
    expect(selectionOf(null, ALL)).toEqual({ counts: null, isolated: [], suspected: [] });
  });
});

describe("the order, by the names a reader sees (§5 M4)", () => {
  it("orders the isolated by unit name, no unit last, then the bed label as the board does, then the key", () => {
    expect(ids(sortRows(answer().isolated, order()))).toEqual(["S-104", "S-101", "S-108", "S-105"]);
    const other = row("S-109", { unit_id: "u-a", bed_label: "İzo 2" });
    expect(ids(sortRows([...answer().isolated, other], order()))).toEqual(["S-109", "S-104", "S-101", "S-108", "S-105"]);
  });

  it("orders the suspected by the server's group, an open clock by the time left, then the same unit, bed and key", () => {
    expect(ids(sortRows(answer().suspected, order({ byGroup: true })))).toEqual(["S-103", "S-102", "S-101", "S-107"]);
    const firing = row("S-110", { bed_label: "9", suspected_infection: true, sort_group: 1 });
    expect(ids(sortRows([LEYLA, firing, ELIF, ALI, AYSE], order({ byGroup: true }))))
      .toEqual(["S-103", "S-102", "S-110", "S-101", "S-107"]);
  });

  it("puts a bed-only row under its bed's unit (§5 M4) and a row with neither last", () => {
    const bedOnly = row("S-111", { unit_id: null, bed_id: BED(11), bed_label: "İzo 1" });
    expect(unitOf(bedOnly, indexStructure(tree()))).toBe(REA);
    expect(unitOf(MURAD, indexStructure(tree()))).toBeNull();
    expect(unitOf(bedOnly, indexStructure(null))).toBeNull();
  });
});

describe("the «Oda» cell (§5 S1, A4 b)", () => {
  const index = indexStructure(tree());

  it("says whether the row's bed is in an isolation room", () => {
    expect(roomCell(AYSE, index, true)).toEqual({ key: "enfeksiyon.room.yes" });
    expect(roomCell(UNNAMED, index, true)).toEqual({ key: "enfeksiyon.room.no" });
  });

  it("says why it cannot: no bed, a bed the tree does not hold, a tree that is not read", () => {
    expect(roomCell(MURAD, index, true)).toEqual({ why: "enfeksiyon.room.noBed" });
    expect(roomCell(row("S-112", { bed_id: "55555555-5555-4555-8555-555555555599" }), index, true))
      .toEqual({ why: "enfeksiyon.room.unknownBed" });                 // never «izolasyon odasında değil»
    expect(roomCell(AYSE, index, false)).toEqual({ why: "tree" });
  });
});

describe("Decision 18 for the counts (spec D15, §5 A3)", () => {
  it("prints a fresh answer's number, 0 included", () => {
    expect(countCell(0, true)).toEqual({ value: 0 });
    expect(countCell(3, true)).toEqual({ value: 3 });
  });

  it("keeps a number above 0 from an answer that is not fresh, and turns its 0 into «—» «liste güncel değil»", () => {
    expect(countCell(3, false)).toEqual({ value: 3, stale: true });
    expect(countCell(0, false)).toEqual({ dash: true, why: "enfeksiyon.notFresh" });
  });

  it("never prints what is no count", () => {
    for (const value of [undefined, null, -1, 1.5, "2"]) expect(countCell(value, true), String(value)).toEqual({ dash: true });
  });

  it("words the free isolation beds from the tree, and «—» with the reason when it cannot", () => {
    const ok = { ok: true };
    expect(freeBedsCell({ total: 10, free: 1, occupied: 4 }, true, ok)).toEqual({ free: 1, total: 10 });
    expect(freeBedsCell({ total: 0, free: 0, occupied: 0 }, true, ok)).toEqual({ dash: true, why: "enfeksiyon.count.noRooms" });
    expect(freeBedsCell({ total: 10, free: 3, occupied: 4 }, false, ok)).toEqual({ dash: true, why: "enfeksiyon.notFresh" });
    expect(freeBedsCell(null, true, { ok: false, why: "failed" })).toEqual({ dash: true, why: "tree" });
  });
});

describe("Decision 18 for the tiles (§5 A4 c)", () => {
  const tiles = Object.fromEntries(isolationBeds(tree(), answer()).map((tile) => [tile.tile, tile]));

  it("words every tile from a fresh answer", () => {
    expect(tileWords(tiles.free, true)).toEqual({ key: "enfeksiyon.beds.tile.free" });
    expect(tileWords(tiles.isolated, true)).toEqual({ key: "enfeksiyon.beds.tile.isolated", lastAnswer: false });
    expect(tileWords(tiles.occupant_unseen, true))
      .toEqual({ key: "enfeksiyon.beds.tile.occupant_unseen", why: "enfeksiyon.beds.tile.occupantUnseenWhy" });
    expect(tileWords(tiles.conflict, true)).toEqual({ key: "enfeksiyon.beds.tile.conflict", stateKey: "kabul.state.AVAILABLE" });
    expect(tileWords(tiles.out_of_service, true)).toEqual({ key: "enfeksiyon.beds.tile.out_of_service" });
    expect(tileWords({ tile: "unknown", state: "NEW_STATE" }, true)).toEqual({ key: "enfeksiyon.unknown", state: "NEW_STATE" });
  });

  it("never says «boş», «izolasyonsuz» or «kayıt yok» from an answer that is not fresh", () => {
    for (const quiet of ["free", "not_isolated", "unrecorded"]) {
      expect(tileWords(tiles[quiet], false), quiet).toEqual({ dash: true, why: "enfeksiyon.notFresh" });
    }
    expect(tileWords(tiles.isolated, false)).toEqual({ key: "enfeksiyon.beds.tile.isolated", lastAnswer: true });
    expect(tileWords(tiles.cleaning, false)).toEqual({ key: "enfeksiyon.beds.tile.cleaning" });     // the tree's own word
  });
});

describe("the alarm cell (spec D13 item 6, §5 A6, M3)", () => {
  it("names each alarm by its kind, toned by its severity, latched, acknowledged or snoozed", () => {
    const r = row("S-113", { sepsis_alarms: [
      { kind: "septic_shock", severity: "critical", first_seen_at: at(70), resolved_at: at(10), acknowledged: false, snooze_until: null },
      { kind: "sepsis", severity: "high", first_seen_at: at(70), resolved_at: null, acknowledged: true, snooze_until: null },
      { kind: "under_resuscitated_sepsis", severity: "high", first_seen_at: at(70), resolved_at: null, acknowledged: false,
        snooze_until: at(-15) },
      { kind: "new_kind", severity: "moderate", first_seen_at: null, resolved_at: null, acknowledged: false, snooze_until: null }] });
    expect(alarmItems(r)).toEqual([
      { kind: "septic_shock", kindKey: "enfeksiyon.kind.septicShock", tone: "crit", latched: true, acknowledged: false, snoozeMs: null },
      { kind: "sepsis", kindKey: "enfeksiyon.kind.sepsis", tone: "high", latched: false, acknowledged: true, snoozeMs: null },
      { kind: "under_resuscitated_sepsis", kindKey: "enfeksiyon.kind.underResuscitated", tone: "high", latched: false,
        acknowledged: false, snoozeMs: Date.parse(at(-15)) },
      { kind: "new_kind", kindKey: null, tone: "mid", latched: false, acknowledged: false, snoozeMs: null }]);
    expect(alarmItems(NIGAR)).toEqual([]);
    expect(alarmItems(KAMRAN)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /c/tmp/g4-enfeksiyon/dashboard && npx vitest run src/live/data/structure.test.js src/live/screens/enfeksiyon/enfeksiyon.test.js`
Expected: `Test Files  2 failed (2)`: `structure.test.js` `1 failed | 27 passed` («says whether a room is an isolation room, …»: `isIsolation` is undefined), and `enfeksiyon.test.js` fails to load (`Failed to resolve import "./enfeksiyon.js"`).

- [ ] **Step 3: Index the isolation mark**

In `dashboard/src/live/data/structure.js`, find:

```js
 *    rooms: Map(id -> {id, name, unitId, isActive}),
 *    beds:  Map(id -> {id, label, state, isActive, roomId, roomName, unitId, unitName, open}) }.
```

Replace with:

```js
 *    rooms: Map(id -> {id, name, unitId, isActive, isIsolation}),
 *    beds:  Map(id -> {id, label, state, isActive, roomId, roomName, unitId, unitName, open, isIsolation}) }.
 *  `isIsolation` (G4-05, spec §5 S1): the room is an isolation room — on the bed, its room's.
```

Then find:

```js
        rooms.set(normId(room.id), { id: room.id, name: room.name, unitId: unit.id,
          isActive: room.is_active !== false });
```

Replace with:

```js
        rooms.set(normId(room.id), { id: room.id, name: room.name, unitId: unit.id,
          isActive: room.is_active !== false, isIsolation: room.is_isolation === true });
```

Then find:

```js
            open: bed.is_active !== false && room.is_active !== false && unit.is_active !== false,
          });
```

Replace with:

```js
            open: bed.is_active !== false && room.is_active !== false && unit.is_active !== false,
            isIsolation: room.is_isolation === true,
          });
```

- [ ] **Step 4: Write the model**

Create `dashboard/src/live/screens/enfeksiyon/enfeksiyon.js` with:

```js
// src/live/screens/enfeksiyon/enfeksiyon.js — «Enfeksiyon kontrol» (G4-05, spec D10–D15 as §5 S1, A3, A4, M3, M4 amend
// them): what the page's cards, tables and tiles say, from the server's answer, the structure tree and the page's
// freshness. Pure: no React, no translator, no request, no clock of its own.
//
// THE SERVER DECIDES THE PATIENTS' WORDS; THE TREE DECIDES THE BEDS. Each row's isolation `state`, its antibiotic
// `state`, its alarms and the counts are the engine's (api/infection.py): nothing here recounts or judges them. The
// isolation beds are the tree's (§5 S1): every open bed of an open room with `is_isolation` in an open unit of the tree
// this session reads — `/tenant/structure`'s own reach — its tile decided here from the tree's bed state and the
// answer's `bed_occupants`, as Doluluk counts its beds from the same tree (occupancy.js). The ORDER of the two lists is
// decided here (§5 M4), by the unit and bed names a reader sees; `sort_group` is the server's.
//
// DECISION 18 (spec D15, §5 A4): never a 0 or a «yok» without a fresh answer. A count, a tile or an alarm cell that
// would say «nothing» from an answer that is not fresh says «—» and why instead. The tree has its own source (ozet.js
// `structureSource`): while it does not count, the bed cells name its reason (`why: "tree"`, worded by the screen).
// No colour judges: the tones are the engine's severities, as Eczane's.
import { BED_STATE_KEYS, normId } from "../../data/structure.js";
import { riskStyle } from "../../ui/riskStyle.js";
import { WITH_PATIENT } from "../doluluk/occupancy.js";
import { msOf } from "../eczane/pharmacyModel.js";

/** The unit filter's «Tüm birimler». A unit's own key is its normalised id. */
export const ALL = "*";
/** The isolation types, in the engine's one order (api/clinical.py ISOLATION_CODES). */
export const TYPES = Object.freeze(["contact", "droplet", "airborne", "protective"]);
/** The tiles this build has words for (spec D10's table; `conflict`, §5 A4 a). Any other is `unknown`. */
export const TILES = Object.freeze(["free", "isolated", "not_isolated", "unrecorded", "occupant_unseen", "conflict",
  "cleaning", "reserved", "out_of_service", "maintenance"]);
/** A bed state with no patient in it → its tile. */
const STATE_TILE = Object.freeze({ AVAILABLE: "free", HOUSEKEEPING: "cleaning", RESERVED: "reserved",
  BLOCKED: "out_of_service", MAINTENANCE: "maintenance" });
/** The three tiles that would say «free», «not isolated» or «nothing recorded»: «—» from an answer that is not fresh. */
const QUIET = new Set(["free", "not_isolated", "unrecorded"]);
const OCCUPANT_STATES = new Set(["isolated", "not_isolated", "unrecorded"]);
const KIND_KEYS = Object.freeze({ septic_shock: "enfeksiyon.kind.septicShock", sepsis: "enfeksiyon.kind.sepsis",
  under_resuscitated_sepsis: "enfeksiyon.kind.underResuscitated" });
const ZERO = Object.freeze({ patients: 0, isolated: 0, isolation_unrecorded: 0, suspected: 0, suspected_unrecorded: 0,
  clock_missed: 0, sepsis_open: 0 });
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const listOf = (value) => (Array.isArray(value) ? value : []);

/** Who lies on each bed, by its normalised id (the answer's `bed_occupants`): `{patient_id, display_name, state, types}`. */
function occupantsByBed(answer) {
  const out = new Map();
  for (const occupant of listOf(answer?.bed_occupants)) {
    if (!isObject(occupant) || occupant.bed_id == null) continue;
    const key = normId(occupant.bed_id);
    out.set(key, [...(out.get(key) ?? []), { patient_id: occupant.patient_id ?? "", display_name: occupant.display_name ?? "",
      state: occupant.isolation?.state ?? null, types: listOf(occupant.isolation?.types) }]);
  }
  return out;
}

/** A tile from its bed's state in the tree and who the answer says lies on it (spec D10's table, §5 A4 a): a bed a
 *  patient is in is `isolated` if one of them is, `not_isolated` if every one is not, `unrecorded` otherwise, and
 *  `occupant_unseen` when none of them is on this list; a bed with a patient whose tree state has none is `conflict` —
 *  never «boş». A state or an occupant's word this build does not know is `unknown`. */
export function tileOf(state, occupants) {
  if (WITH_PATIENT.has(state)) {
    if (occupants.length === 0) return "occupant_unseen";
    if (occupants.some((o) => o.state === "isolated")) return "isolated";
    if (occupants.some((o) => !OCCUPANT_STATES.has(o.state))) return "unknown";
    return occupants.every((o) => o.state === "not_isolated") ? "not_isolated" : "unrecorded";
  }
  if (occupants.length > 0) return "conflict";
  return STATE_TILE[state] ?? "unknown";
}

/** The isolation beds (§5 S1): every open bed of an open room with `is_isolation` in an open unit, in the tree's own
 *  order (units, rooms and beds by name, as the server sorts them). `answer` names the occupants; with none every
 *  occupied bed is `occupant_unseen` (the page draws no tile without an answer). */
export function isolationBeds(tree, answer) {
  const occupants = occupantsByBed(answer);
  const out = [];
  for (const site of listOf(tree?.sites)) {
    for (const unit of listOf(site?.units)) {
      for (const room of listOf(unit?.rooms)) {
        if (room?.is_isolation !== true) continue;
        for (const bed of listOf(room?.beds)) {
          if (unit.is_active === false || room.is_active === false || bed?.is_active === false || bed?.id == null) continue;
          const on = occupants.get(normId(bed.id)) ?? [];
          out.push({ key: normId(bed.id), id: bed.id, label: String(bed.label ?? ""), roomName: String(room.name ?? ""),
            unitId: unit.id, unitKey: normId(unit.id), state: bed.state ?? null, tile: tileOf(bed.state, on), occupants: on });
        }
      }
    }
  }
  return out;
}

/** «{a} dolu · {b} boş» and «boş izolasyon yatağı» «{free} / {total}» (§5 S1): every tile, the free ones, and those
 *  whose bed state has a patient (OCCUPIED and the two pending states, occupancy.js `WITH_PATIENT`). A conflict tile is
 *  in the total and in neither of the two (§5 A4 a). */
export function bedTally(tiles) {
  return { total: tiles.length, free: tiles.filter((tile) => tile.tile === "free").length,
    occupied: tiles.filter((tile) => WITH_PATIENT.has(tile.state)).length };
}

/** The unit filter's choices (§5 S1): the tree's open units, then any other unit the answer names (its `units`, its
 *  rows) — ids, each once by `normId`, for `useUnitNames` to name and sort. */
export function unitChoices(tree, answer) {
  const out = [];
  const seen = new Set();
  const add = (id) => {
    const key = normId(id);
    if (key && !seen.has(key)) {
      seen.add(key);
      out.push(id);
    }
  };
  for (const site of listOf(tree?.sites)) {
    for (const unit of listOf(site?.units)) if (unit?.is_active !== false) add(unit?.id);
  }
  for (const unit of listOf(answer?.units)) add(unit?.unit_id);
  for (const r of [...listOf(answer?.isolated), ...listOf(answer?.suspected)]) add(r?.unit_id);
  return out;
}

/** The selection's counts and rows (spec D13 item 1, §5 S1, M4): «Tüm birimler» is the whole answer; a unit is its
 *  `units[]` entry and the rows whose own `unit_id` is it — a row with no `unit_id` stays under «Tüm birimler» only,
 *  where the server counts it. A unit the answer does not list has no scoped card: its counts are 0 (the page prints a 0
 *  only from a fresh answer). */
export function selectionOf(answer, selected) {
  const mine = (r) => selected === ALL || normId(r?.unit_id) === selected;
  const counts = selected === ALL ? (isObject(answer?.counts) ? answer.counts : null)
    : (listOf(answer?.units).find((unit) => normId(unit?.unit_id) === selected)?.counts ?? (answer ? ZERO : null));
  return { counts, isolated: listOf(answer?.isolated).filter(mine), suspected: listOf(answer?.suspected).filter(mine) };
}

/** The unit a row is shown under in «Birim» (§5 M4): its own, else its bed's in the tree; null when neither says. */
export function unitOf(r, index) {
  if (r?.unit_id) return r.unit_id;
  const bed = r?.bed_id ? index?.beds?.get(normId(r.bed_id)) : null;
  return bed?.unitId ?? null;
}

const BOARD_ORDER = { numeric: true, sensitivity: "base" };

/** A list in the page's order (§5 M4): with `byGroup` (the suspected list) first the server's `sort_group` — 0 an open
 *  clock, least `remaining_sec` first; 1 a firing alarm; 2 the rest — then by the unit's name in the interface language
 *  (`unitOf`, `unitName`; a row on no unit last), the bed label as the board orders it (`localeCompare("en", {numeric:
 *  true, sensitivity: "base"})`; else the key), and the key. A new array. */
export function sortRows(rows, { unitOf: unitIdOf, unitName, lang, byGroup = false }) {
  const groupOf = (r) => (Number.isInteger(r?.sort_group) ? r.sort_group : 2);
  const leftOf = (r) => (Number.isFinite(r?.antibiotic?.remaining_sec) ? r.antibiotic.remaining_sec : 0);
  const bedOf = (r) => String(r?.bed_label || r?.patient_id || "");
  return [...rows].sort((a, b) => {
    if (byGroup) {
      const group = groupOf(a) - groupOf(b);
      if (group) return group;
      const left = groupOf(a) === 0 ? leftOf(a) - leftOf(b) : 0;
      if (left) return left;
    }
    const ua = unitIdOf(a);
    const ub = unitIdOf(b);
    if (!ua !== !ub) return ua ? -1 : 1;
    const unit = ua && ub ? String(unitName(ua)).localeCompare(String(unitName(ub)), lang, BOARD_ORDER) : 0;
    if (unit) return unit;
    const bed = bedOf(a).localeCompare(bedOf(b), "en", BOARD_ORDER);
    return bed || String(a?.patient_id ?? "").localeCompare(String(b?.patient_id ?? ""));
  });
}

/** «Oda» (§5 S1, A4 b): `{key}` — the row's bed is or is not in an isolation room — or `{why}` for a «—»: no bed, a bed
 *  the tree does not hold (never «izolasyon odasında değil»), or `"tree"` while the tree does not count (`treeOk`). */
export function roomCell(r, index, treeOk) {
  if (!treeOk) return { why: "tree" };
  if (!r?.bed_id) return { why: "enfeksiyon.room.noBed" };
  const bed = index?.beds?.get(normId(r.bed_id));
  if (!bed) return { why: "enfeksiyon.room.unknownBed" };
  return { key: bed.isIsolation ? "enfeksiyon.room.yes" : "enfeksiyon.room.no" };
}

/** A count card (spec D15, §5 A3): a fresh answer's number, 0 included; from an answer that is not fresh, a number above
 *  0 (`stale`: the page says as of when) and a 0 as «—» «liste güncel değil»; a value that is no count, «—». */
export function countCell(value, fresh) {
  if (!Number.isInteger(value) || value < 0) return { dash: true };
  if (fresh) return { value };
  return value > 0 ? { value, stale: true } : { dash: true, why: "enfeksiyon.notFresh" };
}

/** «boş izolasyon yatağı» (spec D15, §5 S1, A4 c): «{free} / {total}» from a fresh answer and a tree that counts; no
 *  isolation room: «—» «izolasyon odası tanımlı değil»; an answer that is not fresh: «—» «liste güncel değil»; a tree
 *  that does not count: «—» and the tree's reason (`why: "tree"`). */
export function freeBedsCell(tally, fresh, treeSource) {
  if (!treeSource?.ok) return { dash: true, why: "tree" };
  if (!fresh) return { dash: true, why: "enfeksiyon.notFresh" };
  if (!tally || tally.total === 0) return { dash: true, why: "enfeksiyon.count.noRooms" };
  return { free: tally.free, total: tally.total };
}

/** A tile's words (spec D10's table, D15, §5 A4): `{key}`; `isolated` says whether its types are the last answer's;
 *  `occupant_unseen` adds the «—» reason; `conflict` names the tree's state (`stateKey`); an unknown tile names the
 *  state. From an answer that is not fresh, the three quiet tiles are «—» «liste güncel değil». */
export function tileWords(tile, fresh) {
  if (!fresh && QUIET.has(tile.tile)) return { dash: true, why: "enfeksiyon.notFresh" };
  if (!TILES.includes(tile.tile)) return { key: "enfeksiyon.unknown", state: tile.state ?? tile.tile };
  const key = `enfeksiyon.beds.tile.${tile.tile}`;
  if (tile.tile === "isolated") return { key, lastAnswer: !fresh };
  if (tile.tile === "occupant_unseen") return { key, why: "enfeksiyon.beds.tile.occupantUnseenWhy" };
  if (tile.tile === "conflict") return { key, stateKey: BED_STATE_KEYS[tile.state] ?? "kabul.bedOther" };
  return { key };
}

/** The «Sepsis alarmı» cell's items (spec D13 item 6, §5 A6, M3), in the server's order: the kind's text key (null for a
 *  kind this build does not know: the screen prints the server's word), the tone of its severity (the engine's own,
 *  `riskStyle`), whether it is latched (`resolved_at` set), acknowledged, and the end of its snooze. */
export function alarmItems(r) {
  return listOf(r?.sepsis_alarms).filter(isObject).map((alarm) => ({
    kind: String(alarm.kind ?? ""), kindKey: KIND_KEYS[alarm.kind] ?? null, tone: riskStyle(alarm.severity).tone,
    latched: alarm.resolved_at != null, acknowledged: alarm.acknowledged === true, snoozeMs: msOf(alarm.snooze_until),
  }));
}
```

- [ ] **Step 5: Run them to see them pass**

Run: `cd /c/tmp/g4-enfeksiyon/dashboard && npx vitest run src/live/data src/live/screens/enfeksiyon/enfeksiyon.test.js src/live/screens/kabul src/live/screens/doluluk`
Expected: `Test Files  27 passed (27)`, `Tests  663 passed (663)`.

- [ ] **Step 6: Commit**

```bash
cd /c/tmp/g4-enfeksiyon && git add dashboard/src/live/data/structure.js dashboard/src/live/data/structure.test.js dashboard/src/live/screens/enfeksiyon/enfeksiyon.js dashboard/src/live/screens/enfeksiyon/enfeksiyon.test.js && git commit -m "feat(enfeksiyon): G4-05 the pure page model — isolation beds from the tree with the answer's occupants (every tile, conflict, closed not drawn, the tally), the unit selection, both orders by name, the Birim and Oda cells, Decision 18 for counts, tiles and alarms; indexStructure carries isIsolation" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- dashboard/src/live/data/structure.js dashboard/src/live/data/structure.test.js dashboard/src/live/screens/enfeksiyon/enfeksiyon.js dashboard/src/live/screens/enfeksiyon/enfeksiyon.test.js
```

---

## Task 12 (dashboard): `EnfeksiyonScreen` — the cards, the two tables, the isolation beds, the notes

**Files:**
- Create: `dashboard/src/live/screens/enfeksiyon/EnfeksiyonScreen.jsx`
- Test: `dashboard/src/live/screens/enfeksiyon/EnfeksiyonScreen.test.jsx` (new)

- [ ] **Step 1: Write the failing screen test**

Create `dashboard/src/live/screens/enfeksiyon/EnfeksiyonScreen.test.jsx` with:

```js
// EnfeksiyonScreen.test.jsx — «İnfeksiya nəzarəti» (G4-05, spec D13–D15 as §5 S1, A3, A4, M3, M4, M7 amend them): the
// header and the unit filter (and its fallback), the five cards with their second lines, both tables in the page's
// order, the isolation beds drawn from the tree in every tile state, the notes; the links only with `board.view`; the
// bed section without a structure key and with a failed tree while the rest stands; an answer that is not fresh, a
// failed first read, a refused read, a malformed answer. The default language is az. Synthetic ward
// (enfeksiyon.testutil.js).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { dayStamp } from "../../i18n/dates.js";
import { mount, refusal } from "../../session/mount.testutil.jsx";
import { profile, token } from "../../session/testTokens.testutil.js";
import { StructureProvider } from "../../data/StructureProvider.jsx";
import { UUID_TEXT } from "../kabul/kabul.testutil.js";
import { EnfeksiyonScreen } from "./EnfeksiyonScreen.jsx";
import { COUNTS, NOW, REA, answer, iso, row, tree } from "./enfeksiyon.testutil.js";

/** The default nurse group, as the engine seeds it since G4-05 (auth/permissions.py). */
const NURSE = ["board.view", "alerts.ack", "admissions.view", "admissions.admit", "admissions.transfer.confirm",
  "handover.sign", "clinical.chart", "beds.release", "tasks.view", "tasks.manage", "infection.view"];
const KEY_ONLY = ["infection.view"];
const HONESTY = "Bu səhifədə yoxdur: cihaz günləri (mərkəzi kateter, sidik kateteri, ventilyator), cihazdan istifadə "
  + "nisbəti, infeksiya nisbətləri, antibiotik günü və kultura nəticələri — heç birinin bu sistemdə mənbə qeydi yoxdur; "
  + "heç biri hesablanmayıb. İnfeksiya tərifi və hadisə sayı bu sistemin işi deyil; sistem hədd və ya tərif yaratmır. "
  + "Homunculus diaqnoz qoymur, təyinat vermir.";
const ISOLATION_NOTE = "İzolyasiya klinisistin xəstə ekranından bu sistemə qeyd etdiyi tədbir növləridir; sistem "
  + "izolyasiya tövsiyə etmir, növünü seçmir. “İzolyasiya qeydi yoxdur” qeydin edilmədiyini bildirir; xəstənin "
  + "izolyasiyada olmadığı anlamına gəlmir.";
const ECZANE_NOTE = "“Qeyd yoxdur” və “tətbiq qeydi yoxdur” bu sistemə antibiotik tətbiqinin qeyd edilmədiyini bildirir; "
  + "verilmədiyi anlamına gəlmir.";
const settle = () => new Promise((resolve) => { setTimeout(resolve, 0); });
const pass = (ms) => act(async () => { vi.advanceTimersByTime(ms); await settle(); });
const clock = (ms) => dayStamp(ms, NOW);

async function open({ perms = NURSE, setup } = {}) {
  const mounted = await mount(<StructureProvider><EnfeksiyonScreen /></StructureProvider>, {
    access: token({ perms }), me: profile({ perms }),
    setup: (api) => {
      api.structure.mockResolvedValue(tree());
      api.infection.mockResolvedValue(answer());
      setup?.(api);
    },
  });
  await act(async () => { await settle(); });
  await act(async () => { await settle(); });
  return mounted;
}
const card = (field) => screen.getByTestId(`count-${field}`).textContent;
const tableOf = (name) => screen.getByRole("table", { name });
const rowIds = (name) => [...tableOf(name).querySelectorAll("tbody tr")].map((tr) => tr.getAttribute("data-patient"));
const cell = (name, patientId, column) => tableOf(name).querySelector(`tr[data-patient="${patientId}"] [data-cell="${column}"]`);
const tiles = () => [...document.querySelectorAll("[data-beds] li[data-tile]")];
const tile = (label) => tiles().find((li) => li.querySelector("b").textContent === label);
const tally = () => document.querySelector("[data-tally]")?.textContent ?? null;
/** The page's own alert (ui/Alert, tone crit): the shell keeps other `role="alert"` regions mounted empty. */
const alertBox = () => document.querySelector('[role="alert"][data-tone="crit"]');
const ISOLATED = "İzolyasiyadakı xəstələr: 4";
const SUSPECTED = "Şübhəli infeksiya və ya sepsis siqnalı: 4 xəstə";

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); vi.setSystemTime(NOW); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("the infection-control page", () => {
  it("has one h1, says what it shows and as of when, and reads the list and the tree once on open", async () => {
    const { api } = await open();
    expect(screen.getAllByRole("heading", { level: 1 }).map((h) => h.textContent)).toEqual(["İnfeksiya nəzarəti"]);
    expect(screen.getByText("İzolyasiya, şübhəli infeksiya, antibiotik müddəti və sepsis siqnalları")).toBeInTheDocument();
    expect(document.querySelector("[data-as-of]").textContent).toBe(`${clock(NOW)} vəziyyətinə görə`);
    expect(api.infection).toHaveBeenCalledTimes(1);
    expect(api.infection).toHaveBeenCalledWith();
    expect(api.boardPatients).not.toHaveBeenCalled();             // its patients are its own read
    expect(alertBox()).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Yenilə" })); await settle(); });
    expect(api.infection).toHaveBeenCalledTimes(2);
  });

  it("shows the five cards with the server's numbers, the two «no record» lines and the free isolation beds", async () => {
    await open();
    expect(["isolated", "free_beds", "suspected", "clock_missed", "sepsis_open"].map(card)).toEqual(["4", "1 / 10", "3", "1", "1"]);
    expect(card("isolation_unrecorded")).toBe("3 xəstədə izolyasiya qeydi yoxdur");
    expect(card("suspected_unrecorded")).toBe("4 xəstədə işarə yoxdur");
    const counters = document.querySelector("[data-counters]");
    for (const label of ["izolyasiyada qeydə alınmış xəstə", "boş izolyasiya çarpayısı", "şübhəli infeksiya işarələnmiş xəstə",
      "antibiotik müddəti keçən", "sepsis siqnalı davam edən xəstə", "cavablandırılmış və ya cavablandırılmamış"]) {
      expect(within(counters).getByText(label)).toBeInTheDocument();
    }
  });

  it("lists the isolated by unit and bed name, a patient on no unit last, with the types, the record's time and the room", async () => {
    await open();
    expect(rowIds(ISOLATED)).toEqual(["S-104", "S-101", "S-108", "S-105"]);
    expect(cell(ISOLATED, "S-101", "unit").textContent).toBe("Reanimasiya");
    expect(within(cell(ISOLATED, "S-101", "isolation")).getByText("Təmas")).toBeInTheDocument();
    expect(within(cell(ISOLATED, "S-101", "isolation")).getByText("Damcı")).toBeInTheDocument();
    expect(cell(ISOLATED, "S-101", "isolation").textContent).toContain(`son qeyd ${clock(NOW - 80 * 60_000)}`);
    expect(cell(ISOLATED, "S-101", "room").textContent).toBe("izolyasiya otağı");
    expect(cell(ISOLATED, "S-104", "room").textContent).toBe("izolyasiya otağında deyil");
    expect(cell(ISOLATED, "S-105", "unit").textContent).toBe("— şöbəsi bəlli deyil");
    expect(cell(ISOLATED, "S-105", "room").textContent).toBe("— çarpayısı bəlli deyil");
    const s104 = tableOf(ISOLATED).querySelector('tr[data-patient="S-104"] th');
    expect(s104.textContent).toBe("1kimlik gözlənilir");                  // the bed, and no name from the HIS
  });

  it("lists the suspected by the server's group — the passed clock first — with Eczane's cell and the alarms by kind", async () => {
    await open();
    expect(rowIds(SUSPECTED)).toEqual(["S-103", "S-102", "S-101", "S-107"]);
    expect(cell(SUSPECTED, "S-103", "antibiotic").textContent).toContain("Müddət keçib · 25 dəq");
    expect(cell(SUSPECTED, "S-102", "antibiotic").textContent).toContain("Müddət gedir · 20 dəq qalıb");
    expect(cell(SUSPECTED, "S-107", "antibiotic").textContent).toBe("Qeyd yoxdur");
    expect(cell(SUSPECTED, "S-103", "sepsis").textContent).toBe("Septik şok meyarları ödənilib");
    expect(cell(SUSPECTED, "S-107", "sepsis").textContent).toBe("Septik şok meyarları ödənilibkeçdi · təsdiqlənməyib");
    expect(cell(SUSPECTED, "S-102", "sepsis").textContent).toBe("Açıq sepsis siqnalı yoxdur");
    expect(cell(SUSPECTED, "S-103", "sepsis").querySelector("[data-tone]").getAttribute("data-tone")).toBe("crit");
  });

  it("draws the isolation beds from the tree in every state, with who lies on them and the tally", async () => {
    await open();
    expect(tiles().map((li) => [li.querySelector("b").textContent, li.getAttribute("data-tile")])).toEqual([
      ["İzo 1", "isolated"], ["İzo 2", "free"], ["İzo 3", "occupant_unseen"], ["İzo 4", "cleaning"], ["İzo 5", "reserved"],
      ["İzo 6", "out_of_service"], ["İzo 7", "maintenance"], ["İzo 8", "not_isolated"], ["İzo 9", "unrecorded"],
      ["İzo 10", "conflict"]]);
    const words = (label) => tile(label).querySelector("[data-words]").textContent;
    expect(words("İzo 1")).toBe("izolyasiyalı xəstə");
    expect(within(tile("İzo 1")).getByText("Ayşe Sentetik")).toBeInTheDocument();
    expect(within(tile("İzo 1")).getByText("Təmas")).toBeInTheDocument();
    expect(words("İzo 2")).toBe("boşdur");
    expect(words("İzo 3")).toBe("doludur — xəstə bu siyahıda yoxdur");
    expect(words("İzo 6")).toBe("istifadədən kənardır");                   // no reason: it is Doluluk's read (§5 S1)
    expect(words("İzo 8")).toBe("izolyasiyasız xəstə");
    expect(words("İzo 9")).toBe("izolyasiya qeydi yoxdur");
    expect(words("İzo 10")).toBe("strukturda boş · paneldə xəstə var");     // §5 A4 a: never «boşdur» over a patient
    expect(within(tile("İzo 10")).getByText("Kamran Sentetik")).toBeInTheDocument();
    expect(tally()).toBe("4 doludur · 1 boşdur");
    for (const li of tiles()) expect(li.querySelector("[data-tone]:not([data-tone='warn'])"), li.textContent).toBeNull();
  });

  it("says what the page does not have, what isolation is, and what Eczane's lines say, in every state", async () => {
    await open();
    expect(screen.getByText(HONESTY)).toBeInTheDocument();
    expect(screen.getByText(ISOLATION_NOTE)).toBeInTheDocument();
    expect(screen.getByText(ECZANE_NOTE)).toBeInTheDocument();
    expect(document.querySelector("[data-source]").textContent).toMatch(/^Antibiotik müddəti: .* 1 saat — Surviving Sepsis Campaign 2026/);
    expect(document.body.textContent).not.toMatch(UUID_TEXT);
  });

  it("opens a patient from the bed and the name only for a session that may see the board", async () => {
    await open();
    expect(within(tableOf(ISOLATED)).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual([
      "#/patients/S-104", "#/patients/S-101", "#/patients/S-108", "#/patients/S-105"]);
    cleanup();
    await open({ perms: KEY_ONLY });
    expect(screen.queryAllByRole("link")).toEqual([]);
  });
});

describe("the unit filter (spec D13 item 1, §5 S1)", () => {
  it("offers every unit of the tree and the answer, and narrows the cards, the rows and the tiles to one", async () => {
    await open();
    const select = screen.getByLabelText("Şöbə");
    expect([...select.options].map((o) => o.textContent)).toEqual(["Bütün şöbələr", "Reanimasiya"]);
    await act(async () => { fireEvent.change(select, { target: { value: REA } }); await settle(); });
    expect(rowIds("İzolyasiyadakı xəstələr: 3")).toEqual(["S-104", "S-101", "S-108"]);      // S-105 is on no unit
    expect(card("suspected_unrecorded")).toBe("3 xəstədə işarə yoxdur");
    expect(tiles()).toHaveLength(10);
  });

  it("falls back to «Bütün şöbələr» when a new read no longer lists the chosen unit, and says so", async () => {
    const { api } = await open();
    await act(async () => { fireEvent.change(screen.getByLabelText("Şöbə"), { target: { value: REA } }); await settle(); });
    api.structure.mockResolvedValue({ tenant_id: null, sites: [] });
    api.infection.mockResolvedValue(answer({ units: [], isolated: [], suspected: [], bed_occupants: [],
      counts: { ...COUNTS, patients: 0, isolated: 0, suspected: 0 } }));
    await pass(30_000);
    expect(screen.getByLabelText("Şöbə").value).toBe("*");
    expect(screen.getByText("Seçilmiş şöbə artıq əhatənizdə deyil.")).toBeInTheDocument();
  });
});

describe("Decision 18 (spec D15, §5 A3, A4)", () => {
  it("says a ward is empty only from a fresh answer — and a ward nobody recorded reads 0 with the count of unrecorded", async () => {
    const quiet = answer({ isolated: [], suspected: [], bed_occupants: [], units: [],
      counts: { patients: 5, isolated: 0, isolation_unrecorded: 5, suspected: 0, suspected_unrecorded: 5, clock_missed: 0, sepsis_open: 0 } });
    await open({ setup: (api) => api.infection.mockResolvedValue(quiet) });
    expect(card("isolated")).toBe("0");
    expect(card("isolation_unrecorded")).toBe("5 xəstədə izolyasiya qeydi yoxdur");
    expect(screen.getByText("Əhatənizdə izolyasiyada qeydə alınmış xəstə yoxdur.")).toBeInTheDocument();
    expect(screen.getByText("Əhatənizdə şübhəli infeksiya işarələnmiş və ya sepsis siqnalı olan xəstə yoxdur.")).toBeInTheDocument();
  });

  it("holds a list that is no longer fresh under a crit alert: a 0 and every «none» turn into «—»", async () => {
    const { api } = await open({ setup: (a) => a.infection.mockResolvedValue(answer({ counts: { ...COUNTS, clock_missed: 0 } })) });
    api.infection.mockRejectedValue(refusal(503, "kapsam şu anda okunamıyor"));
    await pass(30_000);
    await pass(30_000);
    await pass(30_000);
    await pass(10_000);
    expect(alertBox().textContent).toMatch(/^İnfeksiya siyahısı aktual deyil · son cavab /);
    expect(card("isolated")).toBe("4");                                    // a number above 0 stays
    expect(card("clock_missed")).toBe("— siyahı aktual deyil");           // a 0 does not
    expect(card("free_beds")).toBe("— siyahı aktual deyil");
    expect(document.querySelector("[data-as-of-stale]").textContent).toMatch(/^son cavab .* vəziyyətinə görə$/);
    expect(document.querySelector("[data-as-of]")).toBeNull();
    expect(tally()).toBe("— siyahı aktual deyil");
    expect(tile("İzo 2").querySelector("[data-words]").textContent).toBe("— siyahı aktual deyil");
    expect(tile("İzo 8").querySelector("[data-words]").textContent).toBe("— siyahı aktual deyil");
    expect(tile("İzo 1").querySelector("[data-words]").textContent).toBe("son cavabda · izolyasiyalı xəstə");
    expect(cell(SUSPECTED, "S-103", "sepsis").textContent).toBe("son cavabda: Septik şok meyarları ödənilib");
    expect(cell(SUSPECTED, "S-102", "sepsis").textContent).toBe("— siyahı aktual deyil");
    expect(cell(SUSPECTED, "S-103", "antibiotic").textContent).toMatch(/^Son cavabda müddət keçmişdi · bitmə /);
  });

  it("draws no card, table, tile or name when the first read fails", async () => {
    await open({ setup: (api) => api.infection.mockRejectedValue(refusal(503, "kapsam şu anda okunamıyor")) });
    expect(alertBox().textContent).toMatch(/^İnfeksiya siyahısı oxunmadı: /);
    expect(document.querySelector("[data-counters]")).toBeNull();
    expect(screen.queryAllByRole("table")).toEqual([]);
    expect(tiles()).toEqual([]);
    expect(document.body.textContent).not.toContain("Sentetik");
    expect(screen.getByText(HONESTY)).toBeInTheDocument();
    expect(screen.getByText(ISOLATION_NOTE)).toBeInTheDocument();
  });

  it("leaves no name on the page once a read is refused", async () => {
    const { api } = await open();
    expect(document.body.textContent).toContain("Ayşe Sentetik");
    api.infection.mockRejectedValue(refusal(403, "permission required: infection.view"));
    await pass(30_000);
    expect(document.body.textContent).not.toContain("Sentetik");
    expect(screen.queryAllByRole("table")).toEqual([]);
  });

  it("takes an answer of another shape for a failed read", async () => {
    await open({ setup: (api) => api.infection.mockResolvedValue({ rows: [] }) });
    expect(alertBox().textContent).toBe("İnfeksiya siyahısı oxunmadı: serverin cavabı bu səhifənin oxuduğu formada deyil");
  });

  it("prints a bed state or an isolation type this build does not know as the server's own word, never «boşdur»", async () => {
    const odd = row("S-120", { bed_label: "1", isolation: iso("isolated", ["quarantine"]) });
    await open({ setup: (api) => {
      const ward = tree();
      ward.sites[0].units[0].rooms[1].beds[1].state = "NEW_STATE";
      api.structure.mockResolvedValue(ward);
      api.infection.mockResolvedValue(answer({ isolated: [odd] }));
    } });
    expect(tile("İzo 2").querySelector("[data-words]").textContent).toBe("Bu versiyanın tanımadığı vəziyyət: NEW_STATE");
    expect(cell("İzolyasiyadakı xəstələr: 1", "S-120", "isolation").textContent).toContain("quarantine");
  });
});

describe("the bed section's own source: the structure tree (§5 S1)", () => {
  it("says the tree cannot be read without a structure key, and the rest of the page stands", async () => {
    const { api } = await open({ perms: KEY_ONLY });
    expect(api.structure).not.toHaveBeenCalled();
    expect(tally()).toBe("— struktur oxuna bilmir");
    expect(document.querySelector("[data-beds]").textContent).toBe("— struktur oxuna bilmir");
    expect(card("free_beds")).toBe("— struktur oxuna bilmir");
    expect(cell(ISOLATED, "S-101", "room").textContent).toBe("— struktur oxuna bilmir");
    expect(card("isolated")).toBe("4");
    expect(rowIds(SUSPECTED)).toEqual(["S-103", "S-102", "S-101", "S-107"]);
  });

  it("says the tree could not be read, and why, when its read fails", async () => {
    await open({ setup: (api) => api.structure.mockRejectedValue(refusal(500, "boom")) });
    expect(tally()).toMatch(/^— struktur oxunmadı: /);
    expect(cell(ISOLATED, "S-101", "room").textContent).toMatch(/^— struktur oxunmadı: /);
    expect(card("isolated")).toBe("4");
  });

  it("reads the tree again with every tick, for a session that may read it", async () => {
    const { api } = await open();
    const before = api.structure.mock.calls.length;
    await pass(30_000);
    expect(api.infection).toHaveBeenCalledTimes(2);
    expect(api.structure.mock.calls.length).toBe(before + 1);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd /c/tmp/g4-enfeksiyon/dashboard && npx vitest run src/live/screens/enfeksiyon/EnfeksiyonScreen.test.jsx`
Expected: the file fails to load — `Failed to resolve import "./EnfeksiyonScreen.jsx"` — `Test Files  1 failed (1)`.

- [ ] **Step 3: Write the screen**

Create `dashboard/src/live/screens/enfeksiyon/EnfeksiyonScreen.jsx` with:

```jsx
// src/live/screens/enfeksiyon/EnfeksiyonScreen.jsx — «Enfeksiyon kontrol» (G4-05, spec D13–D15 as §5 S1, A3, A4, A6, M3,
// M4, M7 amend them): per unit, who is in isolation and where, who has suspected infection or a Sepsis-3 alarm and how
// their antibiotic clock stands, and the isolation beds. Read-only: it charts nothing — an isolation is recorded on the
// patient screen (patient/IsolationBox.jsx), by a person.
//
// TWO SOURCES (§5 S1). The patients are the page's own read (useInfection: GET /infection every 30 s, Eczane's tempo);
// the isolation beds are the shell's structure tree (useStructure, read again with each tick), worded with the answer's
// `bed_occupants`. Either can fail alone: without the tree the bed cells say why and the rest of the page stands;
// without a fresh answer every count, tile and table that would say «none» says «—» and why (Decision 18, spec D15).
//
// THE SERVER DECIDES, THE PAGE FORMATS AND ORDERS (spec D10, §5 M4). The states, the counts and `sort_group` are the
// engine's; the page orders the rows by the unit and bed names it holds (enfeksiyon.js `sortRows`), writes times in the
// reader's clock and, while the answer is fresh, the antibiotic durations as Eczane does (pharmacyModel). Names are shown
// (every default holder is a clinician of the unit); the bed and the name open the patient for a `board.view` holder.
//
// NOTHING HERE JUDGES (spec D19, §5 M7): no tile is coloured as a judgement — the isolation types are tags, the alarm
// tones the engine's severities — no isolation is recommended, and the honesty note says what the page does not have.
import React, { useEffect, useMemo, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { dayStamp } from "../../i18n/dates.js";
import { useSession } from "../../session/SessionProvider.jsx";
import { readErrorText } from "../../apiErrors.js";
import { Alert, Box, Button, FOCUS_RING, Field, Note, Select, StatusPill, Table, Tag } from "../../ui/index.js";
import { useBoard } from "../../data/BoardProvider.jsx";
import { STRUCTURE_PERMS, useStructure, useUnitNames } from "../../data/StructureProvider.jsx";
import { normId } from "../../data/structure.js";
import { ScopeNote, nameOf } from "../common/BoardState.jsx";
import { useNow } from "../common/useNow.js";
import { bedNameOf } from "../beds/order.js";
import { antibioticCell, clockSkewOf, isFresh, msOf } from "../eczane/pharmacyModel.js";
import { WHY, structureSource } from "../ozet/ozet.js";
import {
  ALL, TYPES, alarmItems, bedTally, countCell, freeBedsCell, isolationBeds, roomCell, selectionOf, sortRows, tileWords,
  unitChoices, unitOf,
} from "./enfeksiyon.js";
import { useInfection } from "./useInfection.js";

/** The one window and source Eczane's source sentence states (spec D13 item 6): another is printed by its numbers. */
const WINDOW_MIN = 60;
const WINDOW_SOURCE = "surviving-sepsis-campaign-2026";

/** The five cards (spec D13 item 3, §5 A3, M3): the server's field, its label, and its second line. */
const CARDS = [
  { field: "isolated", label: "enfeksiyon.count.isolated",
    second: { field: "isolation_unrecorded", key: "enfeksiyon.count.isolationUnrecorded" } },
  { field: "free_beds", label: "enfeksiyon.count.freeBeds" },
  { field: "suspected", label: "enfeksiyon.count.suspected",
    second: { field: "suspected_unrecorded", key: "enfeksiyon.count.suspectedUnrecorded" } },
  { field: "clock_missed", label: "enfeksiyon.count.clockMissed" },
  { field: "sepsis_open", label: "enfeksiyon.count.sepsisOpen", note: "enfeksiyon.count.sepsisOpenNote" },
];

/** «—» and why: the one way a cell says it has no value (Decision 18). */
function Dash({ why }) {
  return (
    <span data-dash className="text-mute">
      {"—"}
      {why ? <>{" "}<span className="text-12">{why}</span></> : null}
    </span>
  );
}

/** The isolation types as Doluluk's warn tags, in the engine's order — a type this build does not know as its word. */
function Types({ types }) {
  const { t } = useI18n();
  return (
    <span className="inline-flex flex-wrap gap-1">
      {(Array.isArray(types) ? types : []).map((type) => (
        <Tag key={type} tone="warn">{TYPES.includes(type) ? t(`enfeksiyon.type.${type}`) : String(type)}</Tag>
      ))}
    </span>
  );
}

/** The bed (else the key) and the name, one link to the patient for a `board.view` holder (Eczane D5). */
function Who({ row, canOpen }) {
  const { t } = useI18n();
  const who = (
    <>
      <span className="block font-data text-13.5 font-bold text-ink">{bedNameOf({ bedLabel: row.bed_label, patient_id: row.patient_id })}</span>
      <span className="block text-12.5 font-normal text-mute">{nameOf(row, t)}</span>
    </>
  );
  return canOpen
    ? <a href={`#/patients/${encodeURIComponent(row.patient_id ?? "")}`} className={`block rounded-md ${FOCUS_RING}`}>{who}</a>
    : who;
}

function UnitCell({ row, index, names }) {
  const { t } = useI18n();
  const unit = unitOf(row, index);
  return unit ? names.nameOf(unit) : <Dash why={t("enfeksiyon.unit.none")} />;
}

function Cards({ counts, fresh, tally, source, treeText, staleAsOf }) {
  const { t } = useI18n();
  const shown = (cell) => (cell.dash ? <Dash why={cell.why ? t(cell.why) : null} /> : String(cell.value));
  const second = ({ field, key }) => {
    const cell = countCell(counts?.[field], fresh);
    return cell.dash ? <Dash why={cell.why ? t(cell.why) : null} /> : t(key, { n: cell.value });
  };
  const freeBeds = () => {
    const cell = freeBedsCell(tally, fresh, source);
    if (!cell.dash) return `${cell.free} / ${cell.total}`;
    return <Dash why={cell.why === "tree" ? treeText : t(cell.why)} />;
  };
  return (
    <div data-counters>
      <div className="grid grid-cols-2 gap-2 min-[640px]:grid-cols-3 min-[1000px]:grid-cols-5">
        {CARDS.map((c) => (
          <div key={c.field} className="rounded-box border border-line bg-card px-3 py-2">
            <b data-testid={`count-${c.field}`} className="block font-data text-23 text-ink">
              {c.field === "free_beds" ? freeBeds() : shown(countCell(counts?.[c.field], fresh))}
            </b>
            <span className="block text-12 text-mute">{t(c.label)}</span>
            {c.second ? <span data-testid={`count-${c.second.field}`} className="block text-12 text-mute">{second(c.second)}</span> : null}
            {c.note ? <span className="block text-12 text-mute">{t(c.note)}</span> : null}
          </div>
        ))}
      </div>
      {staleAsOf ? <p data-as-of-stale className="m-0 mt-1 text-12 text-mute">{staleAsOf}</p> : null}
    </div>
  );
}

function IsolatedBox({ data, rows, fresh, canOpen, index, names, treeOk, treeText, nowMs }) {
  const { t } = useI18n();
  let body = null;
  if (data && rows.length > 0) {
    body = (
      <Table caption={t("enfeksiyon.isolated.caption", { n: rows.length })}>
        <thead>
          <tr>
            <th>{t("enfeksiyon.col.bed")}</th>
            <th>{t("enfeksiyon.col.unit")}</th>
            <th>{t("enfeksiyon.col.isolation")}</th>
            <th>{t("enfeksiyon.col.room")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const room = roomCell(row, index, treeOk);
            const charted = msOf(row.isolation?.charted_at);
            return (
              <tr key={row.patient_id} data-patient={row.patient_id}>
                <th scope="row" className="!normal-case !tracking-normal"><Who row={row} canOpen={canOpen} /></th>
                <td data-cell="unit"><UnitCell row={row} index={index} names={names} /></td>
                <td data-cell="isolation">
                  <Types types={row.isolation?.types} />
                  {charted !== null ? (
                    <span className="mt-0.5 block text-12 text-mute">{t("enfeksiyon.lastRecord", { time: dayStamp(charted, nowMs) })}</span>
                  ) : null}
                </td>
                <td data-cell="room">{room.key ? t(room.key) : <Dash why={room.why === "tree" ? treeText : t(room.why)} />}</td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    );
  } else if (data) {
    body = <p data-empty className="m-0 text-13">{fresh ? t("enfeksiyon.isolated.empty") : <Dash why={t("enfeksiyon.notFresh")} />}</p>;
  }
  return (
    <Box title={t("enfeksiyon.isolated.title")} icon="thermo" level={2}>
      <div data-isolated className="grid gap-2">
        {body}
        <p className="m-0 text-12.5 text-mute">{t("enfeksiyon.isolated.note")}</p>
      </div>
    </Box>
  );
}

function Tile({ tile, fresh, canOpen }) {
  const { t, lang } = useI18n();
  const words = tileWords(tile, fresh);
  let said;
  if (words.dash) said = <Dash why={t(words.why)} />;
  else if (words.stateKey) said = t(words.key, { state: t(words.stateKey).toLocaleLowerCase(lang) });
  else if (words.state !== undefined) said = t(words.key, { state: String(words.state) });
  else {
    said = (
      <>
        {words.lastAnswer ? `${t("enfeksiyon.beds.lastAnswer")} · ` : ""}
        {t(words.key)}
        {words.why ? <>{" "}<Dash why={t(words.why)} /></> : null}
      </>
    );
  }
  return (
    <li data-bed={tile.key} data-tile={tile.tile} className="grid gap-1 rounded-ctl border border-line bg-card px-2.5 py-2">
      <span className="flex items-baseline justify-between gap-2">
        <b className="font-data text-15">{tile.label}</b>
        <span className="truncate text-12 text-mute">{tile.roomName}</span>
      </span>
      <span data-words className="text-13">{said}</span>
      {(words.dash ? [] : tile.occupants).map((occupant) => (
        <span key={occupant.patient_id} className="grid gap-0.5">
          {canOpen ? (
            <a href={`#/patients/${encodeURIComponent(occupant.patient_id)}`} className={`rounded-md text-13 font-semibold ${FOCUS_RING}`}>
              {nameOf(occupant, t)}
            </a>
          ) : <span className="text-13 font-semibold">{nameOf(occupant, t)}</span>}
          {occupant.types.length > 0 ? <Types types={occupant.types} /> : null}
        </span>
      ))}
    </li>
  );
}

function BedsBox({ tiles, tally, fresh, treeOk, treeText, canOpen }) {
  const { t } = useI18n();
  let line;
  let body;
  if (!treeOk) {
    line = <Dash why={treeText} />;
    body = <Dash why={treeText} />;
  } else {
    line = fresh ? t("enfeksiyon.beds.tally", { occupied: tally.occupied, free: tally.free }) : <Dash why={t("enfeksiyon.notFresh")} />;
    body = tiles.length > 0 ? (
      <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2 p-0">
        {tiles.map((tile) => <Tile key={tile.key} tile={tile} fresh={fresh} canOpen={canOpen} />)}
      </ul>
    ) : (fresh ? t("enfeksiyon.beds.none") : <Dash why={t("enfeksiyon.notFresh")} />);
  }
  return (
    <Box title={t("enfeksiyon.beds.title")} icon="bed" level={2} right={<span data-tally>{line}</span>}>
      <div data-beds className="text-13">{body}</div>
    </Box>
  );
}

function AntibioticCell({ row, nowMs, fresh }) {
  const { t } = useI18n();
  const stamp = (ms) => (ms === null ? "—" : dayStamp(ms, nowMs));
  const cell = antibioticCell(row, nowMs, fresh);
  const text = t(cell.key, {
    duration: cell.duration ? t(cell.duration.key, cell.duration.params) : "—",
    time: stamp(cell.timeMs),
    state: String(cell.state ?? "—"),
  });
  return (
    <>
      {cell.tone ? <StatusPill tone={cell.tone}>{text}</StatusPill> : <span className={cell.state === "none" ? "text-mute" : ""}>{text}</span>}
      {cell.second ? <span className="mt-0.5 block text-12 text-mute">{t(cell.second.key, { time: stamp(cell.second.timeMs) })}</span> : null}
    </>
  );
}

function AlarmCell({ row, fresh, nowMs }) {
  const { t } = useI18n();
  const items = alarmItems(row);
  if (items.length === 0) {
    return fresh ? <span className="text-mute">{t("enfeksiyon.alarm.none")}</span> : <Dash why={t("enfeksiyon.notFresh")} />;
  }
  return items.map((item, at) => {
    const kind = item.kindKey ? t(item.kindKey) : item.kind;
    const notes = [
      item.latched ? t("alarms.resolvedUnacked") : null,
      item.acknowledged ? t("enfeksiyon.alarm.acknowledged") : null,
      item.snoozeMs !== null ? t("enfeksiyon.alarm.snoozed", { time: dayStamp(item.snoozeMs, nowMs) }) : null,
    ].filter(Boolean);
    return (
      <span key={`${item.kind}-${at}`} data-alarm={item.kind} className="block">
        <StatusPill tone={item.tone}>{fresh ? kind : t("enfeksiyon.alarm.lastAnswer", { kind })}</StatusPill>
        {notes.length > 0 ? <span className="ms-1 text-12 text-mute">{notes.join(" · ")}</span> : null}
      </span>
    );
  });
}

function SuspectedBox({ data, rows, fresh, canOpen, index, names, nowMs }) {
  const { t } = useI18n();
  const standard = data?.antibiotic_window_min === WINDOW_MIN && data?.antibiotic_window_source === WINDOW_SOURCE;
  let body = null;
  if (data && rows.length > 0) {
    body = (
      <Table caption={t("enfeksiyon.suspected.caption", { n: rows.length })}>
        <thead>
          <tr>
            <th>{t("enfeksiyon.col.bed")}</th>
            <th>{t("enfeksiyon.col.unit")}</th>
            <th>{t("enfeksiyon.col.antibiotic")}</th>
            <th>{t("enfeksiyon.col.sepsis")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.patient_id} data-patient={row.patient_id}>
              <th scope="row" className="!normal-case !tracking-normal"><Who row={row} canOpen={canOpen} /></th>
              <td data-cell="unit"><UnitCell row={row} index={index} names={names} /></td>
              <td data-cell="antibiotic"><AntibioticCell row={row} nowMs={nowMs} fresh={fresh} /></td>
              <td data-cell="sepsis"><AlarmCell row={row} fresh={fresh} nowMs={nowMs} /></td>
            </tr>
          ))}
        </tbody>
      </Table>
    );
  } else if (data) {
    body = <p data-empty className="m-0 text-13">{fresh ? t("enfeksiyon.suspected.empty") : <Dash why={t("enfeksiyon.notFresh")} />}</p>;
  }
  return (
    <Box title={t("enfeksiyon.suspected.title")} icon="flask" level={2}>
      <div data-suspected className="grid gap-2">
        {body}
        <p className="m-0 text-12.5 text-mute">{t("eczane.note")}</p>
        {data ? (
          <p data-source className="m-0 text-12.5 text-mute">
            {standard
              ? t("eczane.source")
              : t("eczane.sourceOther", { minutes: String(data.antibiotic_window_min ?? "—"), source: String(data.antibiotic_window_source ?? "—") })}
          </p>
        ) : null}
      </div>
    </Box>
  );
}

export function EnfeksiyonScreen() {
  const { t, lang } = useI18n();
  const { user, store } = useSession();
  const tree = useStructure();
  const perms = user?.perms ?? [];
  const mayTree = STRUCTURE_PERMS.some((key) => perms.includes(key));
  const canOpen = perms.includes("board.view");
  const { data, error, skewMs, refresh } = useInfection(store, { reloadStructure: mayTree ? tree.reload : null });
  // The page's clock is the server's for every session (Eczane D17): the board's skew for a `board.view` holder, else
  // the skew of this page's own answers — a session holding `infection.view` alone has no board store behind it.
  const { clockSkewMs } = useBoard();
  const nowMs = useNow(10_000) + clockSkewOf(clockSkewMs, skewMs);
  const fresh = isFresh(data, error, nowMs);
  const source = structureSource(tree, mayTree);
  const treeText = source.ok ? null
    : source.why === WHY.failed ? t("enfeksiyon.structure.failed", { reason: readErrorText(t, tree.error) })
      : source.why === WHY.loading ? t("enfeksiyon.structure.loading") : t("enfeksiyon.structure.noRight");

  // The filter offers the tree's units and the answer's (§5 S1), named and ordered as every screen names them; a unit
  // a new read no longer lists falls back to «Tüm birimler», and the page says so (spec D13 item 1).
  const choiceIds = useMemo(() => unitChoices(tree.known ? tree.structure : null, data), [tree.known, tree.structure, data]);
  const names = useUnitNames(choiceIds);
  const [picked, setPicked] = useState(ALL);
  const [gone, setGone] = useState(false);
  const listed = picked === ALL || choiceIds.some((id) => normId(id) === picked);
  useEffect(() => {
    if (!listed && data) {
      setPicked(ALL);
      setGone(true);
    }
  }, [listed, data]);
  const selected = listed ? picked : ALL;

  const selection = selectionOf(data, selected);
  const ordering = { unitOf: (row) => unitOf(row, tree.index), unitName: names.nameOf, lang };
  const isolated = sortRows(selection.isolated, ordering);
  const suspected = sortRows(selection.suspected, { ...ordering, byGroup: true });
  const tiles = data && source.ok
    ? isolationBeds(tree.structure, data).filter((tile) => selected === ALL || tile.unitKey === selected) : [];
  const tally = bedTally(tiles);
  const answeredMs = msOf(data?.now);
  const answered = answeredMs === null ? "—" : dayStamp(answeredMs, nowMs);
  const reason = error ? (error.malformed ? t("enfeksiyon.malformed") : readErrorText(t, error)) : null;

  return (
    <div className="flex min-h-0 max-w-[1200px] flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="m-0 font-display text-23 font-bold">{t("enfeksiyon.title")}</h1>
          <p className="m-0 text-13 text-mute">{t("enfeksiyon.intro")}</p>
          {data && fresh ? <p data-as-of className="m-0 mt-0.5 text-12 text-mute">{t("enfeksiyon.asOf", { time: answered })}</p> : null}
        </div>
        <Field label={t("enfeksiyon.unit.label")} layout="col" className="min-w-[200px] max-w-[320px]">
          <Select value={selected} onChange={(event) => { setPicked(event.target.value); setGone(false); }}>
            <option value={ALL}>{t("enfeksiyon.unit.all")}</option>
            {names.sorted.map((id) => <option key={normId(id)} value={normId(id)}>{names.nameOf(id)}</option>)}
          </Select>
        </Field>
        <Button size="sm" icon="clock" onClick={() => { refresh(); }}>{t("enfeksiyon.refresh")}</Button>
      </div>
      {gone ? <Note tone="info" icon="alert">{t("enfeksiyon.unit.gone")}</Note> : null}
      {!data && !error ? <Note tone="info" icon="clock">{t("enfeksiyon.loading")}</Note> : null}
      {!data && error ? <Alert tone="crit"><p className="m-0">{t("enfeksiyon.readFailed", { reason })}</p></Alert> : null}
      {data && !fresh ? (
        <Alert tone="crit">
          <p className="m-0">{t("enfeksiyon.stale", { time: answered })}</p>
          {reason ? <p className="m-0 mt-1 font-normal">{reason}</p> : null}
        </Alert>
      ) : null}
      {data ? <ScopeNote scope={data.scope} scopeNote={data.scope_note} /> : null}
      {data ? (
        <Cards counts={selection.counts} fresh={fresh} tally={tally} source={source} treeText={treeText}
          staleAsOf={fresh ? null : t("enfeksiyon.staleAsOf", { time: answered })} />
      ) : null}
      <IsolatedBox data={data} rows={isolated} fresh={fresh} canOpen={canOpen} index={tree.index} names={names}
        treeOk={source.ok} treeText={treeText} nowMs={nowMs} />
      {data ? <BedsBox tiles={tiles} tally={tally} fresh={fresh} treeOk={source.ok} treeText={treeText} canOpen={canOpen} /> : null}
      <SuspectedBox data={data} rows={suspected} fresh={fresh} canOpen={canOpen} index={tree.index} names={names} nowMs={nowMs} />
      <p data-honesty className="m-0 text-12.5 text-mute">{t("enfeksiyon.honesty")}</p>
    </div>
  );
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `cd /c/tmp/g4-enfeksiyon/dashboard && npx vitest run src/live/screens/enfeksiyon`
Expected: `Test Files  3 passed (3)`, `Tests  49 passed (49)`.

- [ ] **Step 5: Commit**

```bash
cd /c/tmp/g4-enfeksiyon && git add dashboard/src/live/screens/enfeksiyon/EnfeksiyonScreen.jsx dashboard/src/live/screens/enfeksiyon/EnfeksiyonScreen.test.jsx && git commit -m "feat(enfeksiyon): G4-05 EnfeksiyonScreen — the unit filter, five cards with their unrecorded lines, the isolated and the suspected tables in the page's order (Eczane's antibiotic cell, the alarm kinds as criteria met), the isolation beds from the tree, the notes; Decision 18 everywhere" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- dashboard/src/live/screens/enfeksiyon/EnfeksiyonScreen.jsx dashboard/src/live/screens/enfeksiyon/EnfeksiyonScreen.test.jsx
```

---

## Task 13 (dashboard): the patient screen's «İzolasyon» box

**Files:**
- Create: `dashboard/src/live/screens/patient/IsolationBox.jsx`
- Test: `dashboard/src/live/screens/patient/IsolationBox.test.jsx` (new)
- Modify: `dashboard/src/live/screens/patient/PatientScreen.jsx` (the header comment; the import; the Sepsis / Meds grid)
- Test: `dashboard/src/live/screens/patient/PatientScreen.test.jsx` (the «five things» test; a block for the box)
- Modify: `dashboard/src/live/i18n/strings/patient.js` (four languages: `onlyWrite`'s count and list; `isolation.*` after `chartRefused`)
- Modify: `dashboard/src/liveAdapters.js` (`patientFromBoard`: `isolation`)
- Test: `dashboard/src/liveAdapters.test.js` (a test in `patientFromBoard`'s block)

- [ ] **Step 1: Write the failing box test**

Create `dashboard/src/live/screens/patient/IsolationBox.test.jsx` with:

```js
// IsolationBox.test.jsx — the patient screen's «İzolyasiya» box (G4-05, spec D16 as §5 S2, A1, M2, M8 amend it): the
// state line in its three words and, while the board is not LIVE, none that says «yoxdur»; the last record's time; the
// four boxes seeded from the card and sent all four, in order, with no time; busy and announced; every answer — saved,
// a discharged number, a refusal naming the bed, no answer (and a board read again), the session changed, superseded;
// the draft kept on failure; a newer record holds the save; a move to another patient resets the box; no key, no box.
// The default language is az. Synthetic ids only.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { dayStamp } from "../../i18n/dates.js";
import { mount, refusal } from "../../session/mount.testutil.jsx";
import { profile, token } from "../../session/testTokens.testutil.js";
import { NOW } from "../../data/board.testutil.js";
import { IsolationBox, seedOf } from "./IsolationBox.jsx";

const T1 = new Date(NOW - 80 * 60_000).toISOString();
const T2 = new Date(NOW - 5 * 60_000).toISOString();
const ISOLATED = { contact: true, droplet: true, airborne: false, protective: null, types: ["contact", "droplet"],
  state: "isolated", charted_at: T1 };
const NOT_ISOLATED = { contact: false, droplet: false, airborne: false, protective: false, types: [],
  state: "not_isolated", charted_at: T1 };
const ORDER = ["isolation_contact", "isolation_droplet", "isolation_airborne", "isolation_protective"];
const settle = () => new Promise((resolve) => { setTimeout(resolve, 0); });

/** A host that can hand the box a new card or move it to another patient, as the shell does (it stays mounted). */
function Host({ initial, chart, refresh }) {
  const [props, setProps] = React.useState(initial);
  Host.set = setProps;
  return <IsolationBox bed="REA-01 · 2" canChart known nowMs={NOW} onChart={chart} onRefresh={refresh} {...props} />;
}

async function open({ isolation = ISOLATED, patientId = "S-001", known = true, canChart = true, chart, refresh } = {}) {
  const onChart = chart ?? vi.fn().mockResolvedValue({ patient_id: patientId, charted: 4, alerts: [] });
  const onRefresh = refresh ?? vi.fn();
  await mount(<Host initial={{ patientId, isolation, known, canChart }} chart={onChart} refresh={onRefresh} />, {
    access: token({ perms: ["board.view", "clinical.chart"] }), me: profile({ perms: ["board.view", "clinical.chart"] }),
  });
  await act(async () => { await settle(); });
  return { onChart, onRefresh };
}
const box = () => screen.getByRole("heading", { name: "İzolyasiya" }).closest("div.rounded-box");
const boxes = () => within(box()).queryAllByRole("checkbox");
const ticked = () => boxes().map((input) => input.checked);
const press = (name) => act(async () => { fireEvent.click(within(box()).getByRole("button", { name })); await settle(); });
const toasts = () => within(screen.getByRole("region", { name: "Bildirişlər" }));
const SAVE = "İzolyasiyanı yadda saxla";

beforeEach(() => { vi.setSystemTime(NOW); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("the state line and the last record", () => {
  it("says the types of an isolated patient, and when it was last recorded — never by whom (§5 S2)", async () => {
    await open();
    expect(within(box()).getByRole("note").textContent).toBe("İzolyasiya: Təmas · Damcı");
    expect(within(box()).getByText(`Son qeyd: ${dayStamp(Date.parse(T1), NOW)}`)).toBeInTheDocument();
  });

  it("tells «no isolation on record» from «nothing ever recorded», and says nothing of a last record without one", async () => {
    await open({ isolation: NOT_ISOLATED });
    expect(within(box()).getByRole("note").textContent).toBe("Açıq izolyasiya qeydi yoxdur: son qeyddə heç bir növ işarələnməyib.");
    cleanup();
    await open({ isolation: null });
    expect(within(box()).getByRole("note").textContent)
      .toBe("İzolyasiya qeydi yoxdur: bu xəstə üçün bu sistemə heç vaxt izolyasiya qeyd edilməyib.");
    expect(box().querySelector("[data-last-record]")).toBeNull();
  });

  it("says no «yoxdur» while the board is not LIVE, keeps an isolation's types, and holds the save", async () => {
    const { onChart } = await open({ isolation: NOT_ISOLATED, known: false });
    expect(within(box()).getByRole("note").textContent).toBe("İzolyasiya vəziyyəti göstərilə bilmir — panel aktual deyil.");
    expect(within(box()).getByText("Panel aktual deyil — qeyd üçün panelin yenidən qoşulmasını gözləyin.")).toBeInTheDocument();
    expect(within(box()).queryByRole("button", { name: SAVE })).toBeNull();
    expect(onChart).not.toHaveBeenCalled();
    cleanup();
    await open({ known: false });
    expect(within(box()).getByRole("note").textContent).toBe("İzolyasiya: Təmas · Damcı · panel aktual deyil");
  });
});

describe("the four boxes", () => {
  it("are seeded from the card: a flag charted true is ticked, false and never charted are not", async () => {
    await open();
    expect(within(box()).getAllByRole("checkbox").map((input) => input.closest("label").textContent))
      .toEqual(["Təmas", "Damcı", "Hava yolu", "Qoruyucu"]);
    expect(ticked()).toEqual([true, true, false, false]);
    expect(seedOf(null)).toEqual({ contact: false, droplet: false, airborne: false, protective: false });
  });

  it("send all four, in the engine's order, with no time", async () => {
    const { onChart } = await open();
    fireEvent.click(boxes()[2]);
    await press(SAVE);
    expect(onChart).toHaveBeenCalledTimes(1);
    expect(onChart).toHaveBeenCalledWith(ORDER.map((code, at) => ({ code, value: [1, 1, 1, 0][at] })));
    expect(toasts().getAllByText("İzolyasiya qeyd edildi.").length).toBeGreaterThan(0);
  });

  it("save four unticked boxes on a patient nobody recorded as «no isolation», and say so on the button", async () => {
    const { onChart } = await open({ isolation: null });
    await press("İzolyasiya yoxdur kimi yadda saxla");
    expect(onChart).toHaveBeenCalledWith(ORDER.map((code) => ({ code, value: 0 })));
    cleanup();
    await open({ isolation: NOT_ISOLATED });
    expect(within(box()).getByRole("button", { name: SAVE })).toBeInTheDocument();     // a record exists: plain «save»
  });

  it("are not drawn without clinical.chart, and the box says why", async () => {
    await open({ canChart: false });
    expect(boxes()).toEqual([]);
    expect(within(box()).getByText("Bu qeyd üçün səlahiyyətiniz çatmır (clinical.chart).")).toBeInTheDocument();
  });
});

describe("the answers (§5 M2)", () => {
  it("is busy while in flight, one save at a time, and says so", async () => {
    let land;
    const chart = vi.fn(() => new Promise((resolve) => { land = resolve; }));
    await open({ chart });
    await press(SAVE);
    await press(SAVE);
    expect(chart).toHaveBeenCalledTimes(1);
    expect(within(box()).getByRole("button", { name: SAVE }).getAttribute("aria-busy")).toBe("true");
    await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 700); }); });
    expect(within(box()).getByRole("status").textContent).toBe("İzolyasiya qeyd edilir…");
    await act(async () => { land({ charted: 4 }); await settle(); });
    expect(within(box()).getByRole("button", { name: SAVE }).getAttribute("aria-busy")).toBeNull();
  });

  it("names the bed, never the patient, on a refusal, and keeps the draft", async () => {
    const chart = vi.fn().mockRejectedValue(refusal(400, "isolation_contact: yalnız 0 veya 1 olabilir"));
    await open({ chart });
    fireEvent.click(boxes()[3]);
    await press(SAVE);
    expect(toasts().getAllByText(/^REA-01 · 2: izolyasiya qeyd edilmədi — /).length).toBeGreaterThan(0);
    expect(ticked()).toEqual([true, true, false, true]);
  });

  it("says a discharged number took nothing, and keeps the draft", async () => {
    await open({ chart: vi.fn().mockResolvedValue({ patient_id: "S-001", dropped: "discharged" }) });
    fireEvent.click(boxes()[3]);
    await press(SAVE);
    expect(toasts().getAllByText("REA-01 · 2 tərxis edilib; izolyasiya qeyd edilmədi.").length).toBeGreaterThan(0);
    expect(ticked()).toEqual([true, true, false, true]);
  });

  it("says a save with no answer may have landed, reads the board again once, and keeps the draft", async () => {
    for (const failure of [Object.assign(new Error("zaman aşımı"), { code: "REQUEST_TIMEOUT" }),
      Object.assign(new Error("Bad gateway"), { status: 503 }), new TypeError("Failed to fetch")]) {
      // eslint-disable-next-line no-await-in-loop
      const { onRefresh } = await open({ chart: vi.fn().mockRejectedValue(failure) });
      fireEvent.click(boxes()[3]);
      // eslint-disable-next-line no-await-in-loop
      await press(SAVE);
      expect(toasts().getAllByText(/^REA-01 · 2: cavab gəlmədi; qeyd edilmiş ola bilər/).length, failure.message).toBeGreaterThan(0);
      expect(onRefresh, failure.message).toHaveBeenCalledTimes(1);
      expect(ticked(), failure.message).toEqual([true, true, false, true]);
      cleanup();
    }
  });

  it("says nothing when the session changed or the request was superseded", async () => {
    for (const chart of [vi.fn().mockResolvedValue(null), vi.fn().mockRejectedValue(Object.assign(new Error("x"), { superseded: true }))]) {
      // eslint-disable-next-line no-await-in-loop
      await open({ chart });
      // eslint-disable-next-line no-await-in-loop
      await press(SAVE);
      expect(screen.getByRole("region", { name: "Bildirişlər" }).textContent).toBe("");
      cleanup();
    }
  });

  it("re-seeds from the reloaded card after a save, and not when the answer lands for a patient no longer shown", async () => {
    let land;
    const chart = vi.fn(() => new Promise((resolve) => { land = resolve; }));
    await open({ chart });
    fireEvent.click(boxes()[3]);
    await press(SAVE);
    act(() => { Host.set({ patientId: "S-002", isolation: NOT_ISOLATED, known: true, canChart: true }); });
    expect(ticked()).toEqual([false, false, false, false]);           // the next patient's own card
    fireEvent.click(boxes()[0]);
    await act(async () => { land({ charted: 4 }); await settle(); });
    expect(ticked()).toEqual([true, false, false, false]);            // her draft is untouched by the other's answer
  });
});

describe("no blind overwrite (§5 A1)", () => {
  it("holds a save when a newer record came after the boxes were touched, then sends it or starts again", async () => {
    const { onChart } = await open();
    fireEvent.click(boxes()[2]);
    act(() => { Host.set({ patientId: "S-001", isolation: { ...ISOLATED, charted_at: T2 }, known: true, canChart: true }); });
    await press(SAVE);
    expect(onChart).not.toHaveBeenCalled();
    expect(within(box()).getByText(`Bu arada yeni izolyasiya qeydi gəldi (${dayStamp(Date.parse(T2), NOW)}); seçiminiz ona baxılaraq edilməyib.`))
      .toBeInTheDocument();
    await press("Seçimdən imtina et");
    expect(ticked()).toEqual([true, true, false, false]);             // re-seeded from the card
    fireEvent.click(boxes()[2]);
    act(() => { Host.set({ patientId: "S-001", isolation: { ...ISOLATED, charted_at: T1 }, known: true, canChart: true }); });
    await press(SAVE);
    await press("Yenə də yadda saxla");
    expect(onChart).toHaveBeenCalledTimes(1);
  });

  it("follows the card while untouched: a newer record is no conflict", async () => {
    const { onChart } = await open();
    act(() => { Host.set({ patientId: "S-001", isolation: { ...NOT_ISOLATED, charted_at: T2 }, known: true, canChart: true }); });
    expect(ticked()).toEqual([false, false, false, false]);
    await press(SAVE);
    expect(onChart).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Write the failing screen and adapter tests**

In `dashboard/src/live/screens/patient/PatientScreen.test.jsx`, find:

```js
  it("names the bed and the patient, and says the five things it writes and that the SOFA form is signed too", async () => {
    await open({ payload: board([entry("S-001", [], FULL)]) });
    expect(screen.getByRole("heading", { level: 1, name: "Ayşe Sentetik" })).toBeInTheDocument();
    // One h1 and no more: the shell moves focus to <main> after every move, and the screen's own
    // heading is what a reader lands on.
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByText("REA-01 · 2")).toBeInTheDocument();
    expect(screen.getByText(/heç nə yazılmır/)).toHaveTextContent(/beş şey yazır/);
    // G3-01 (D3b): the bedside set, entered with «Ölçmə daxil et», and that a value can be withdrawn.
    expect(screen.getByText(/heç nə yazılmır/)).toHaveTextContent(/şübhəli infeksiya işarəsi, xəstənin norması, dərman \/ maye qeydi, SOFA formasından daxil edilən ölçmələr və «Ölçmə daxil et» ilə daxil edilən çarpayı başı ölçmələri/);
```

Replace with:

```js
  it("names the bed and the patient, and says the six things it writes and that the SOFA form is signed too", async () => {
    await open({ payload: board([entry("S-001", [], FULL)]) });
    expect(screen.getByRole("heading", { level: 1, name: "Ayşe Sentetik" })).toBeInTheDocument();
    // One h1 and no more: the shell moves focus to <main> after every move, and the screen's own
    // heading is what a reader lands on.
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByText("REA-01 · 2")).toBeInTheDocument();
    expect(screen.getByText(/heç nə yazılmır/)).toHaveTextContent(/altı şey yazır, hər altısı/);
    // G3-01 (D3b): the bedside set, entered with «Ölçmə daxil et», and that a value can be withdrawn. G4-05 (spec §5
    // M6): the isolation record, after the suspected-infection mark.
    expect(screen.getByText(/heç nə yazılmır/)).toHaveTextContent(/şübhəli infeksiya işarəsi, izolyasiya qeydi, xəstənin norması, dərman \/ maye qeydi, SOFA formasından daxil edilən ölçmələr və «Ölçmə daxil et» ilə daxil edilən çarpayı başı ölçmələri/);
```

Then find:

```js
  it("charts one entry, in the engine's own code and value", async () => {
```

Replace with:

```js
  // G4-05 (spec D16, §5 M8): the «İzolyasiya» box — under the Sepsis box in the left cell of the two-column grid (Meds
  // on the right), reading the card's own block, saving all four flags for the patient shown through the store.
  it("draws the isolation box under the Sepsis box, in its cell, and reads the card's block", async () => {
    const isolation = { contact: true, droplet: null, airborne: null, protective: null, types: ["contact"],
      state: "isolated", charted_at: ago(600) };
    await openChartable({ payload: board([entry("S-001", [], { ...SEPSIS, isolation })]) });
    const sepsis = screen.getByRole("heading", { name: "Sepsis-3 konteksti" }).closest("div.rounded-box");
    const box = screen.getByRole("heading", { name: "İzolyasiya" }).closest("div.rounded-box");
    expect(sepsis.parentElement).toBe(box.parentElement);
    expect(sepsis.nextElementSibling).toBe(box);
    expect(box.parentElement.nextElementSibling).toBe(screen.getByRole("heading", { name: "Dərman və antibiotik" }).closest("div.rounded-box"));
    expect(within(box).getByRole("note").textContent).toBe("İzolyasiya: Təmas");
  });

  it("saves the four isolation flags for the patient shown, with no time, and reads the board again", async () => {
    const { api } = await openChartable();
    const before = api.boardPatients.mock.calls.length;
    const box = screen.getByRole("heading", { name: "İzolyasiya" }).closest("div.rounded-box");
    fireEvent.click(within(box).getByRole("checkbox", { name: "Damcı" }));
    await act(async () => { fireEvent.click(within(box).getByRole("button", { name: "İzolyasiyanı yadda saxla" })); await settle(); });
    expect(api.chart).toHaveBeenCalledWith("S-001", [{ code: "isolation_contact", value: 0 }, { code: "isolation_droplet", value: 1 },
      { code: "isolation_airborne", value: 0 }, { code: "isolation_protective", value: 0 }], null);
    expect(api.boardPatients.mock.calls.length).toBe(before + 1);
  });

  it("charts one entry, in the engine's own code and value", async () => {
```

In `dashboard/src/liveAdapters.test.js`, find:

```js
describe("patientFromBoard", () => {
  it("carries the machine-measured vitals across", () => {
```

Replace with:

```js
describe("patientFromBoard", () => {
  // G4-05 (spec D8): the card's isolation block, untouched; null on a card with none (identity-only, or older).
  it("carries the card's isolation block through, and null when there is none", () => {
    const isolation = { contact: true, droplet: null, airborne: false, protective: null, types: ["contact"],
      state: "isolated", charted_at: "2026-11-12T08:10:00+00:00" };
    expect(patientFromBoard({ ...entry, isolation }).isolation).toEqual(isolation);
    expect(patientFromBoard(entry).isolation).toBeNull();
    expect(patientFromBoard({ ...entry, isolation: null }).isolation).toBeNull();
  });

  it("carries the machine-measured vitals across", () => {
```

- [ ] **Step 3: Run them to see them fail**

Run: `cd /c/tmp/g4-enfeksiyon/dashboard && npx vitest run src/live/screens/patient/IsolationBox.test.jsx src/live/screens/patient/PatientScreen.test.jsx src/liveAdapters.test.js`
Expected: `Test Files  3 failed (3)`, `Tests  4 failed | 173 passed (177)` — `IsolationBox.test.jsx` fails to load (`Failed to resolve import "./IsolationBox.jsx"`); in `PatientScreen.test.jsx` «… says the six things it writes …», «draws the isolation box under the Sepsis box, …» and «saves the four isolation flags …»; in `liveAdapters.test.js` «carries the card's isolation block through, …».

- [ ] **Step 4: The words, in four languages**

In `dashboard/src/live/i18n/strings/patient.js`, find:

```js
    onlyWrite: "Bu ekran hasta kaydına beş şey yazar, beşi de yalnız clinical.chart yetkisiyle: şüpheli enfeksiyon işareti, hastanın normali,
```

Replace with:

```js
    onlyWrite: "Bu ekran hasta kaydına altı şey yazar, altısı da yalnız clinical.chart yetkisiyle: şüpheli enfeksiyon işareti, izolasyon kaydı, hastanın normali,
```

Then find:

```js
    onlyWrite: "Bu ekran xəstə qeydinə beş şey yazır, hər beşi yalnız clinical.chart səlahiyyəti ilə: şübhəli infeksiya işarəsi, xəstənin norması,
```

Replace with:

```js
    onlyWrite: "Bu ekran xəstə qeydinə altı şey yazır, hər altısı yalnız clinical.chart səlahiyyəti ilə: şübhəli infeksiya işarəsi, izolyasiya qeydi, xəstənin norması,
```

Then find:

```js
    onlyWrite: "Этот экран записывает в карту пациента пять вещей, все только с правом clinical.chart: отметку о подозрении на инфекцию, норму пациента,
```

Replace with:

```js
    onlyWrite: "Этот экран записывает в карту пациента шесть вещей, все только с правом clinical.chart: отметку о подозрении на инфекцию, запись об изоляции, норму пациента,
```

Then find:

```js
    onlyWrite: "This screen writes five things to the patient's record, all only with clinical.chart: the suspected-infection charting, the patient's normal,
```

Replace with:

```js
    onlyWrite: "This screen writes six things to the patient's record, all only with clinical.chart: the suspected-infection charting, the isolation record, the patient's normal,
```

Then find:

```js
    chartRefused: "{subject}: şüpheli enfeksiyon işaretlenmedi — {reason}",
```

Replace with:

```js
    chartRefused: "{subject}: şüpheli enfeksiyon işaretlenmedi — {reason}",
    // G4-05 (spec D16, §5 S2, A1, M2): the «İzolasyon» box. The types are `enfeksiyon.type.*`. «Kayıt yok» is never
    // «izolasyonda değil»; a save names the bed (`subject`), never the patient.
    isolation: {
      title: "İzolasyon",
      types: "İzolasyon türleri",
      isolated: "İzolasyon: {types}",
      notIsolated: "Açık izolasyon kaydı yok: son kayıtta hiçbir tür işaretli değil.",
      unrecorded: "İzolasyon kaydı yok: bu hasta için bu sisteme hiç izolasyon kaydedilmedi.",
      boardStale: "pano güncel değil",
      cannotShow: "İzolasyon durumu gösterilemiyor — pano güncel değil.",
      lastRecord: "Son kayıt: {time}",
      note: "Klinik bir kayıttır, öneri değil: adınızla ve saatiyle denetim kaydına yazılır. Geri alınmaz — yeni bir kayıt üstüne yazar. İzolasyonu bitirmek için dört türün işaretini kaldırıp kaydedin.",
      noRight: "Bu kaydı yapma yetkiniz yok (clinical.chart).",
      save: "İzolasyonu kaydet",
      saveNone: "İzolasyon yok olarak kaydet",
      saveAnyway: "Yine de kaydet",
      discard: "Seçimden vazgeç",
      saving: "İzolasyon kaydediliyor…",
      saved: "İzolasyon kaydedildi.",
      dropped: "{subject} taburcu edilmiş; izolasyon kaydedilmedi.",
      refused: "{subject}: izolasyon kaydedilmedi — {reason}",
      mayHaveLanded: "{subject}: yanıt gelmedi; kaydedilmiş olabilir — birazdan İzolasyon kutusuna bakın.",
      heldStale: "Pano güncel değil — kayıt için panonun yeniden bağlanmasını bekleyin.",
      newer: "Bu arada yeni bir izolasyon kaydı geldi ({time}); seçiminiz ona bakılarak yapılmadı.",
    },
```

Then find:

```js
    chartRefused: "{subject}: şübhəli infeksiya işarələnmədi — {reason}",
```

Replace with:

```js
    chartRefused: "{subject}: şübhəli infeksiya işarələnmədi — {reason}",
    isolation: {
      title: "İzolyasiya",
      types: "İzolyasiya növləri",
      isolated: "İzolyasiya: {types}",
      notIsolated: "Açıq izolyasiya qeydi yoxdur: son qeyddə heç bir növ işarələnməyib.",
      unrecorded: "İzolyasiya qeydi yoxdur: bu xəstə üçün bu sistemə heç vaxt izolyasiya qeyd edilməyib.",
      boardStale: "panel aktual deyil",
      cannotShow: "İzolyasiya vəziyyəti göstərilə bilmir — panel aktual deyil.",
      lastRecord: "Son qeyd: {time}",
      note: "Kliniki qeyddir, tövsiyə deyil: adınız və vaxtı ilə audit jurnalına düşür. Geri götürülmür — yeni qeyd onun üstünə yazılır. İzolyasiyanı bitirmək üçün dörd növün işarəsini götürüb yadda saxlayın.",
      noRight: "Bu qeyd üçün səlahiyyətiniz çatmır (clinical.chart).",
      save: "İzolyasiyanı yadda saxla",
      saveNone: "İzolyasiya yoxdur kimi yadda saxla",
      saveAnyway: "Yenə də yadda saxla",
      discard: "Seçimdən imtina et",
      saving: "İzolyasiya qeyd edilir…",
      saved: "İzolyasiya qeyd edildi.",
      dropped: "{subject} tərxis edilib; izolyasiya qeyd edilmədi.",
      refused: "{subject}: izolyasiya qeyd edilmədi — {reason}",
      mayHaveLanded: "{subject}: cavab gəlmədi; qeyd edilmiş ola bilər — bir azdan İzolyasiya qutusuna baxın.",
      heldStale: "Panel aktual deyil — qeyd üçün panelin yenidən qoşulmasını gözləyin.",
      newer: "Bu arada yeni izolyasiya qeydi gəldi ({time}); seçiminiz ona baxılaraq edilməyib.",
    },
```

Then find:

```js
    chartRefused: "{subject}: подозрение на инфекцию не отмечено — {reason}",
```

Replace with:

```js
    chartRefused: "{subject}: подозрение на инфекцию не отмечено — {reason}",
    isolation: {
      title: "Изоляция",
      types: "Виды изоляции",
      isolated: "Изоляция: {types}",
      notIsolated: "Открытой записи об изоляции нет: в последней записи не отмечен ни один вид.",
      unrecorded: "Записи об изоляции нет: для этого пациента в эту систему изоляция ни разу не записывалась.",
      boardStale: "панель не актуальна",
      cannotShow: "Состояние изоляции нельзя показать — панель не актуальна.",
      lastRecord: "Последняя запись: {time}",
      note: "Это клиническая запись, а не рекомендация: она попадает в журнал аудита с вашим именем и временем. Не отзывается — новая запись пишется поверх. Чтобы завершить изоляцию, снимите отметки со всех четырёх видов и сохраните.",
      noRight: "У вас нет права делать эту запись (clinical.chart).",
      save: "Сохранить изоляцию",
      saveNone: "Сохранить как «изоляции нет»",
      saveAnyway: "Всё равно сохранить",
      discard: "Отменить выбор",
      saving: "Изоляция сохраняется…",
      saved: "Изоляция сохранена.",
      dropped: "{subject}: пациент выписан; изоляция не сохранена.",
      refused: "{subject}: изоляция не сохранена — {reason}",
      mayHaveLanded: "{subject}: ответа нет; запись могла сохраниться — вскоре проверьте блок «Изоляция».",
      heldStale: "Панель не актуальна — для записи дождитесь повторного подключения панели.",
      newer: "Тем временем пришла новая запись об изоляции ({time}); ваш выбор сделан без неё.",
    },
```

Then find:

```js
    chartRefused: "{subject}: the suspected infection was not charted — {reason}",
```

Replace with:

```js
    chartRefused: "{subject}: the suspected infection was not charted — {reason}",
    isolation: {
      title: "Isolation",
      types: "Isolation types",
      isolated: "Isolation: {types}",
      notIsolated: "No open isolation record: the last record ticks no type.",
      unrecorded: "No isolation record: no isolation was ever recorded in this system for this patient.",
      boardStale: "the board is not current",
      cannotShow: "The isolation state cannot be shown — the board is not current.",
      lastRecord: "Last record: {time}",
      note: "A clinical record, not a recommendation: it goes into the audit trail under your name and time. It is not withdrawn — a new record is written over it. To end an isolation, untick all four types and save.",
      noRight: "You do not have the right to make this record (clinical.chart).",
      save: "Save isolation",
      saveNone: "Save as «no isolation»",
      saveAnyway: "Save anyway",
      discard: "Discard the choice",
      saving: "Saving the isolation…",
      saved: "Isolation saved.",
      dropped: "{subject} has been discharged; the isolation was not saved.",
      refused: "{subject}: the isolation was not saved — {reason}",
      mayHaveLanded: "{subject}: no answer came; it may have been saved — look at the Isolation box shortly.",
      heldStale: "The board is not current — wait for it to reconnect before saving.",
      newer: "A new isolation record came meanwhile ({time}); your choice was made without it.",
    },
```

- [ ] **Step 5: Write the box**

Create `dashboard/src/live/screens/patient/IsolationBox.jsx` with:

```jsx
// src/live/screens/patient/IsolationBox.jsx — G4-05 «Enfeksiyon kontrol» (spec D16 as §5 S2, A1, M2, M8 amend it): the
// patient's isolation precautions as charted, and — for a `clinical.chart` holder — the four flags to chart them.
//
// A CLINICAL RECORD, NOT A SUGGESTION. The system ticks nothing of its own: the boxes follow what was last charted (a
// flag charted true is ticked; false and never charted are not), and the save sends all four, 1 or 0, through the chart
// door with no time (the server's instant is the record's), where each is a `chart` row under the clinician's own name.
// Nothing is withdrawn: a new save is written over the last, and an isolation is ended by four unticked boxes saved.
// Four unticked boxes on a patient nobody recorded are saved as «no isolation», and the button says so (§5 M2).
//
// «UNRECORDED» IS NOT «NOT ISOLATED» (spec D16). The state line says which of the three the card holds — and, while the
// board is not LIVE, says no «yok» at all (Decision 18): an isolated card keeps its types with «pano güncel değil», the
// other two become one sentence that the state cannot be shown. Nothing is saved from a board that is not LIVE (§5 A1).
//
// NO BLIND OVERWRITE (§5 A1). Untouched, the boxes follow the card. Once touched they are a draft, seeded from the card's
// `charted_at` of that moment; if the card carries a newer record when the save is pressed, nothing is sent: the box says
// a new record came and offers «Yine de kaydet» or «Seçimden vazgeç» (which re-seeds from the card).
//
// THE ANSWERS (§5 M2, the fluid dialog's rules): busy while in flight, one at a time, never `disabled`; a write the store
// dropped (`null`: the session changed) or a superseded one says nothing; a discharged number is a warn; a refusal names
// the bed (never the patient's name, Decision 14) and the reason; no answer (`mayHaveLanded`) may have written some of
// the four rows — the box says so and has the board read again (`onRefresh`). The draft stays on every failure; a
// success re-seeds it, for the patient still shown only. The save button names what it saves: the patient screen has
// other «Kaydet» buttons (plan note N15).
import React, { useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { dayStamp } from "../../i18n/dates.js";
import { apiErrorText } from "../../apiErrors.js";
import { Announce, Box, Button, Note, useToast } from "../../ui/index.js";
import { mayHaveLanded } from "../admin/refusal.js";
import { TYPES } from "../enfeksiyon/enfeksiyon.js";
import { msOf } from "../eczane/pharmacyModel.js";

/** The boxes a card's block seeds: a flag charted true is ticked; false and never charted are not. */
export const seedOf = (isolation) => Object.fromEntries(TYPES.map((type) => [type, isolation?.[type] === true]));

/** `isolation`: the card's block (api/board.py `_isolation`), or null — read as «unrecorded». `bed`: the toast's subject
 *  (the bed label, else the key). `known`: the board is LIVE. `onChart(entries)` saves for this patient and resolves to
 *  the store's answer; `onRefresh()` reads the board again. */
export function IsolationBox({ patientId, isolation, bed, canChart, known, nowMs, onChart, onRefresh }) {
  const { t } = useI18n();
  const toast = useToast();
  const chartedAt = isolation?.charted_at ?? null;
  const state = isolation?.state ?? "unrecorded";
  const [draft, setDraft] = useState(null);           // null: untouched — the boxes follow the card
  const [seededAt, setSeededAt] = useState(null);     // the card's `charted_at` the draft was seeded from (§5 A1)
  const [held, setHeld] = useState(false);            // the save was pressed over a newer record (§5 A1)
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const shown = useRef(patientId);
  // The shell keeps the patient screen mounted across a move to another patient: the draft and the busy state are the
  // patient's, not the box's.
  useEffect(() => {
    shown.current = patientId;
    sending.current = false;
    setDraft(null);
    setHeld(false);
    setBusy(false);
  }, [patientId]);
  const boxes = draft ?? seedOf(isolation);
  const stamp = (iso) => {
    const ms = msOf(iso);
    return ms === null ? "—" : dayStamp(ms, nowMs);
  };
  const typesText = (types) => (Array.isArray(types) ? types : [])
    .map((type) => (TYPES.includes(type) ? t(`enfeksiyon.type.${type}`) : String(type))).join(" · ");

  function touch(type) {
    if (draft === null) setSeededAt(chartedAt);
    setDraft({ ...boxes, [type]: !boxes[type] });
    setHeld(false);
  }
  function discard() {
    setDraft(null);
    setHeld(false);
  }
  async function send(chosen) {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setHeld(false);
    const asked = patientId;
    const subject = bed;
    let say = null;
    try {
      const answer = await onChart(TYPES.map((type) => ({ code: `isolation_${type}`, value: chosen[type] ? 1 : 0 })));
      if (answer === null) return;                       // the session changed: nothing is said into the next one
      if (answer?.dropped) {
        say = [t("patient.isolation.dropped", { subject }), "warn"];
        return;
      }
      say = [t("patient.isolation.saved")];
      if (shown.current === asked) setDraft(null);       // the boxes follow the reloaded card again
    } catch (err) {
      if (err?.superseded) return;
      if (mayHaveLanded(err)) {
        say = [t("patient.isolation.mayHaveLanded", { subject }), "warn"];
        onRefresh?.();
      } else {
        say = [t("patient.isolation.refused", { subject, reason: apiErrorText(t, err) }), "error"];
      }
    } finally {
      if (shown.current === asked) {
        sending.current = false;
        setBusy(false);
      }
      if (say) toast(...say);
    }
  }
  function press() {
    if (draft !== null && chartedAt !== seededAt) {
      setHeld(true);                                     // a newer record came: nothing is sent (§5 A1)
      return;
    }
    send(boxes);
  }

  let line;
  let tone = "info";
  if (state === "isolated") {
    line = `${t("patient.isolation.isolated", { types: typesText(isolation?.types) })}${known ? "" : ` · ${t("patient.isolation.boardStale")}`}`;
  } else if (!known) {
    line = t("patient.isolation.cannotShow");
    tone = "warn";
  } else if (state === "not_isolated") {
    line = t("patient.isolation.notIsolated");
  } else if (state === "unrecorded") {
    line = t("patient.isolation.unrecorded");
    tone = "warn";
  } else {
    line = t("enfeksiyon.unknown", { state: String(state) });
  }
  const recordNone = state === "unrecorded" && TYPES.every((type) => !boxes[type]);

  return (
    <Box title={t("patient.isolation.title")} icon="thermo" level={2}>
      <Note tone={tone} icon={tone === "warn" ? "alert" : "ok"}>{line}</Note>
      {chartedAt ? <p data-last-record className="m-0 mt-1 text-12 text-mute">{t("patient.isolation.lastRecord", { time: stamp(chartedAt) })}</p> : null}
      {canChart ? (
        <div className="mt-2.5 border-t border-line pt-2.5">
          <fieldset className="m-0 min-w-0 border-0 p-0">
            <legend className="m-0 p-0 text-12.5 font-semibold">{t("patient.isolation.types")}</legend>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
              {TYPES.map((type) => (
                <label key={type} className="inline-flex items-center gap-1.5 text-13">
                  <input type="checkbox" checked={boxes[type]} onChange={() => touch(type)} />
                  {t(`enfeksiyon.type.${type}`)}
                </label>
              ))}
            </div>
          </fieldset>
          <p className="m-0 mt-1.5 text-11.5 text-mute">{t("patient.isolation.note")}</p>
          {!known ? (
            <p data-held className="m-0 mt-1.5 text-12.5 font-semibold text-att-ink">{t("patient.isolation.heldStale")}</p>
          ) : held ? (
            <div data-newer className="mt-1.5 grid gap-1.5">
              <p className="m-0 text-12.5 font-semibold text-att-ink">{t("patient.isolation.newer", { time: stamp(chartedAt) })}</p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" busy={busy} onClick={() => send(boxes)}>{t("patient.isolation.saveAnyway")}</Button>
                <Button size="sm" variant="ghost" onClick={discard}>{t("patient.isolation.discard")}</Button>
              </div>
            </div>
          ) : (
            <div className="mt-1.5 flex flex-wrap gap-2">
              <Button size="sm" busy={busy} onClick={press}>{t(recordNone ? "patient.isolation.saveNone" : "patient.isolation.save")}</Button>
              {draft !== null ? <Button size="sm" variant="ghost" onClick={discard}>{t("patient.isolation.discard")}</Button> : null}
            </div>
          )}
          {/* A busy Button reads only "unavailable" to a screen reader; the words come from here. */}
          <Announce text={busy ? t("patient.isolation.saving") : ""} />
        </div>
      ) : <p className="m-0 mt-2 text-12 text-mute">{t("patient.isolation.noRight")}</p>}
    </Box>
  );
}
```

- [ ] **Step 6: Put the box on the patient screen and carry the block through the adapter**

In `dashboard/src/live/screens/patient/PatientScreen.jsx`, find:

```jsx
// It writes FIVE things, and says so in as many words (`patient.onlyWrite`), each only for a
// `clinical.chart` holder: whether an infection is suspected (Task 15B, Decision 27); since Group 2 ·
```

Replace with:

```jsx
// It writes SIX things, and says so in as many words (`patient.onlyWrite`), each only for a
// `clinical.chart` holder: whether an infection is suspected (Task 15B, Decision 27); since G4-05, from the
// «İzolasyon» box (`IsolationBox.jsx`, spec D16), the patient's isolation precautions; since Group 2 ·
```

Then find:

```jsx
import { FluidsBox } from "./fluids/FluidsBox.jsx"; // G3-03 (D10)
```

Replace with:

```jsx
import { FluidsBox } from "./fluids/FluidsBox.jsx"; // G3-03 (D10)
import { IsolationBox } from "./IsolationBox.jsx"; // G4-05 (D16)
```

Then find:

```jsx
          <div className="grid gap-2 min-[861px]:grid-cols-2">
            <Sepsis sepsis={patient.sepsis} canChart={canChart} onChart={chart} pending={charting} />
```

Replace with:

```jsx
          <div className="grid gap-2 min-[861px]:grid-cols-2">
            {/* G4-05 (spec D16, §5 M8): the left cell is a column — Sepsis, then İzolasyon; Meds stays on the right, and on
                a narrow screen the order is Sepsis, İzolasyon, Meds. */}
            <div className="grid content-start gap-2">
              <Sepsis sepsis={patient.sepsis} canChart={canChart} onChart={chart} pending={charting} />
              <IsolationBox patientId={id} isolation={patient.isolation ?? null} bed={bed} canChart={canChart} known={known}
                nowMs={nowMs} onChart={(entries) => board.store.chart(id, entries)} onRefresh={() => board.store.refresh()} />
            </div>
```

In `dashboard/src/liveAdapters.js`, find:

```js
    meds: entry?.meds ?? null,
```

Replace with:

```js
    meds: entry?.meds ?? null,
    // G4-05 (spec D8): the isolation precautions a clinician charted — {contact, droplet, airborne, protective (each
    // true / false / null), types, state, charted_at} — or null on a card with none (identity-only, or an older api),
    // which the patient screen's «İzolasyon» box reads as «unrecorded».
    isolation: entry?.isolation ?? null,
```

- [ ] **Step 7: Run them to see them pass**

Run: `cd /c/tmp/g4-enfeksiyon/dashboard && npx vitest run src/live/screens/patient src/liveAdapters.test.js src/live/i18n`
Expected: `Test Files  38 passed (38)`, `Tests  819 passed (819)`.

- [ ] **Step 8: Commit**

```bash
cd /c/tmp/g4-enfeksiyon && git add dashboard/src/live/screens/patient/IsolationBox.jsx dashboard/src/live/screens/patient/IsolationBox.test.jsx dashboard/src/live/screens/patient/PatientScreen.jsx dashboard/src/live/screens/patient/PatientScreen.test.jsx dashboard/src/live/i18n/strings/patient.js dashboard/src/liveAdapters.js dashboard/src/liveAdapters.test.js && git commit -m "feat(patient): G4-05 the «İzolasyon» box under the Sepsis box — the state line in its three words and none of «yok» off LIVE, the last record's time, four flags saved together with every answer of the fluid dialog, no blind overwrite (§5 A1, M2); onlyWrite names six things; the adapter carries the block" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- dashboard/src/live/screens/patient/IsolationBox.jsx dashboard/src/live/screens/patient/IsolationBox.test.jsx dashboard/src/live/screens/patient/PatientScreen.jsx dashboard/src/live/screens/patient/PatientScreen.test.jsx dashboard/src/live/i18n/strings/patient.js dashboard/src/liveAdapters.js dashboard/src/liveAdapters.test.js
```

---

## Task 14 (dashboard): an existing room marked as an isolation room on Yapı, and `structure.isolation` on «Denetim bütünlüğü» (§5 O1)

**Files:**
- Modify: `dashboard/src/live/screens/admin/StructureTab.jsx` (`Node`'s `action`; the room's line)
- Test: `dashboard/src/live/screens/admin/StructureTab.test.jsx` (a test after the room rename)
- Modify: `dashboard/src/live/i18n/strings/kabul.js` (four languages, after `isolation` / `newRoomIsolation`)
- Modify: `dashboard/src/live/screens/denetim/denetim.js` (`EVENT_TYPES`, after Yapı's four)
- Modify: `dashboard/src/live/i18n/strings/denetim.js` (four languages: `structureIsolation`)
- Test: `dashboard/src/live/screens/denetim/denetim.test.js` (61 → 62)
- Test: `dashboard/src/live/screens/denetim/engineTypes.test.js` (the anchor list; the `_changes` comment)

- [ ] **Step 1: Write the failing tests**

In `dashboard/src/live/screens/admin/StructureTab.test.jsx`, find:

```js
    expect(within(line("Otaq 1")).queryByText(/Otaq nömrəsi|İzolyasiya/)).toBeNull();
```

Replace with:

```js
    // G4-05 (spec §5 O1): the line's own «İzolyasiya otağı et» button is no tag — only the tag's whole text is asked.
    expect(within(line("Otaq 1")).queryByText(/^Otaq nömrəsi|^İzolyasiya otağı$/)).toBeNull();
```

Then find:

```js
  it("renames a room under its unit's name", async () => {
```

Replace with:

```js
  // G4-05 (spec §5 O1): an existing room marked or unmarked as an isolation room, from its own line, on the toast in the
  // tab's own words — the subject first, then what happened.
  it("marks a room as an isolation room and unmarks one, each named after the room", async () => {
    const tree = structure();
    tree.sites[0].units[0].rooms[1].is_isolation = true;                 // Otaq 2 isolates already
    const { api } = await mountKabul(<StructureTab />, { perms: ADMIN, setup: (a) => a.structure.mockResolvedValue(tree) });
    await press("İzolyasiya otağı et: Otaq 1 · Reanimasiya");
    expect(api.patchRoom).toHaveBeenCalledWith(ROOM1, { is_isolation: true });
    expect(toasts().getAllByText("Otaq 1 · Reanimasiya · izolyasiya otağı kimi işarələndi").length).toBeGreaterThan(0);
    await press("İzolyasiya işarəsini götür: Otaq 2 · Reanimasiya");
    expect(api.patchRoom).toHaveBeenCalledWith(ROOM2, { is_isolation: false });
    expect(toasts().getAllByText("Otaq 2 · Reanimasiya · artıq izolyasiya otağı deyil").length).toBeGreaterThan(0);
  });

  it("holds the room's other writes while its isolation mark is out, and says why", async () => {
    let land;
    const { api } = await mountKabul(<StructureTab />, { perms: ADMIN,
      setup: (a) => a.patchRoom.mockReturnValue(new Promise((resolve) => { land = resolve; })) });
    await press("İzolyasiya otağı et: Otaq 1 · Reanimasiya");
    expect(button("İzolyasiya otağı et: Otaq 1 · Reanimasiya").getAttribute("aria-busy")).toBe("true");
    const close = button("Bağla: Otaq 1 · Reanimasiya");
    expect(close.getAttribute("aria-disabled")).toBe("true");
    expect(describedBy(close).textContent).toBe("Otaq 1 · Reanimasiya · yadda saxlanılır…");
    await act(async () => { land({}); });
    await settle();
    expect(api.patchRoom).toHaveBeenCalledTimes(1);
  });

  it("renames a room under its unit's name", async () => {
```

In `dashboard/src/live/screens/denetim/denetim.test.js`, find:

```js
    expect(EVENT_TYPES).toHaveLength(61);   // … + G2-B5b's alert_snooze + G2-B1c's three care-team events; + the follow-up's 14 (D3, engineTypes.test.js); + G2-B1b's move and its board retry; + G4-04's shift.assign; + G3-05's three
    expect(new Set(EVENT_TYPES.map((e) => e.code)).size).toBe(61);
```

Replace with:

```js
    expect(EVENT_TYPES).toHaveLength(62);   // … + G2-B5b's alert_snooze + G2-B1c's three care-team events; + the follow-up's 14 (D3, engineTypes.test.js); + G2-B1b's move and its board retry; + G4-04's shift.assign; + G3-05's three; + G4-05's structure.isolation
    expect(new Set(EVENT_TYPES.map((e) => e.code)).size).toBe(62);
    expect(typeKey("structure.isolation")).toBe("denetim.type.structureIsolation");               // G4-05 (spec §5 O1)
```

In `dashboard/src/live/screens/denetim/engineTypes.test.js`, find:

```js
  // A PATCH writes one row per change `_changes()` builds: a rename, and a close or a reopen.
```

Replace with:

```js
  // A PATCH writes one row per change `_changes()` builds: a rename, a close or a reopen, and (G4-05) a room's isolation mark.
```

Then find:

```js
      "structure.rename", "structure.reopen", "structure.close",    // a PATCH's loop over _changes()
```

Replace with:

```js
      "structure.rename", "structure.reopen", "structure.close",    // a PATCH's loop over _changes()
      "structure.isolation",                                        // … its room's isolation mark (G4-05, spec §5 O1)
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /c/tmp/g4-enfeksiyon/dashboard && npx vitest run src/live/screens/admin/StructureTab.test.jsx src/live/screens/denetim`
Expected: with the engine at Task 1: `Tests  4 failed | 101 passed (105)` — `StructureTab.test.jsx` «marks a room as an isolation room and unmarks one, …» and «holds the room's other writes …», `denetim.test.js` «names the engine's codes …» (61, not 62), and `engineTypes.test.js` «finds every way the engine writes a type, …» (its new anchor). With the engine's Task 5 in, that last one passes and «names every type the engine writes» fails instead (N12).

- [ ] **Step 3: The room's button, its words and its audit label**

In `dashboard/src/live/screens/admin/StructureTab.jsx`, find:

```jsx
function Node({ kind, item, name, subject, tags, maxLength, busy, held, onRename, onToggle, children }) {
```

Replace with:

```jsx
function Node({ kind, item, name, subject, tags, maxLength, busy, held, onRename, onToggle, action = null, children }) {
```

Then find:

```jsx
            aria-label={`${t("kabul.rename")}: ${subject}`} onClick={() => setRenaming((on) => !on)}>{t("kabul.rename")}</Button>
```

Replace with:

```jsx
            aria-label={`${t("kabul.rename")}: ${subject}`} onClick={() => setRenaming((on) => !on)}>{t("kabul.rename")}</Button>
          {action}
```

Then find:

```jsx
                          busy={isBusy(room.id)} held={holdFor(room.id)}
                          onRename={(name) => write(room.id, roomName, () => api.patchRoom(room.id, { name }), "kabul.renamed")}
```

Replace with:

```jsx
                          busy={isBusy(room.id)} held={holdFor(room.id)}
                          // G4-05 (spec §5 O1): mark or unmark the room as an isolation room — the tab's own write,
                          // notice and reload; a busy key of its own, so only this button turns busy and the room's
                          // other writes are held while it is out.
                          action={(
                            <Button size="sm" variant="ghost" busy={isBusy(`${room.id}~iso`)}
                              aria-label={`${t(room.is_isolation ? "kabul.isolationUnmark" : "kabul.isolationMark")}: ${roomName}`}
                              aria-disabled={holdFor(`${room.id}~iso`) ? "true" : undefined}
                              aria-describedby={holdFor(`${room.id}~iso`)}
                              onClick={holdFor(`${room.id}~iso`) ? () => {} : () => write(`${room.id}~iso`, roomName,
                                () => api.patchRoom(room.id, { is_isolation: !room.is_isolation }),
                                room.is_isolation ? "kabul.isolationOff" : "kabul.isolationOn")}>
                              {t(room.is_isolation ? "kabul.isolationUnmark" : "kabul.isolationMark")}
                            </Button>
                          )}
                          onRename={(name) => write(room.id, roomName, () => api.patchRoom(room.id, { name }), "kabul.renamed")}
```

In `dashboard/src/live/i18n/strings/kabul.js`, find:

```js
    isolation: "İzolasyon odası", newRoomIsolation: "{unit} içinde yeni oda izolasyon odasıdır",
```

Replace with:

```js
    isolation: "İzolasyon odası", newRoomIsolation: "{unit} içinde yeni oda izolasyon odasıdır",
    // G4-05 (spec §5 O1): an existing room marked or unmarked. The two done texts follow the subject on the toast
    // («{oda} · {birim} · …», admin.doneFor), as `renamed` and `closedDone` do.
    isolationMark: "İzolasyon odası yap", isolationUnmark: "İzolasyon işaretini kaldır",
    isolationOn: "izolasyon odası olarak işaretlendi", isolationOff: "artık izolasyon odası değil",
```

Then find:

```js
    isolation: "İzolyasiya otağı", newRoomIsolation: "{unit} daxilində yeni otaq izolyasiya otağıdır",
```

Replace with:

```js
    isolation: "İzolyasiya otağı", newRoomIsolation: "{unit} daxilində yeni otaq izolyasiya otağıdır",
    isolationMark: "İzolyasiya otağı et", isolationUnmark: "İzolyasiya işarəsini götür",
    isolationOn: "izolyasiya otağı kimi işarələndi", isolationOff: "artıq izolyasiya otağı deyil",
```

Then find:

```js
    isolation: "Изолятор", newRoomIsolation: "Новая палата в «{unit}» — изолятор",
```

Replace with:

```js
    isolation: "Изолятор", newRoomIsolation: "Новая палата в «{unit}» — изолятор",
    isolationMark: "Сделать изолятором", isolationUnmark: "Снять отметку изолятора",
    isolationOn: "отмечена как изолятор", isolationOff: "больше не изолятор",
```

Then find:

```js
    isolation: "Isolation room", newRoomIsolation: "The new room in {unit} is an isolation room",
```

Replace with:

```js
    isolation: "Isolation room", newRoomIsolation: "The new room in {unit} is an isolation room",
    isolationMark: "Make an isolation room", isolationUnmark: "Remove the isolation mark",
    isolationOn: "marked as an isolation room", isolationOff: "no longer an isolation room",
```

In `dashboard/src/live/screens/denetim/denetim.js`, find:

```js
  ["structure.create", "structureCreate"], ["structure.rename", "structureRename"],
  ["structure.close", "structureClose"], ["structure.reopen", "structureReopen"],
```

Replace with:

```js
  ["structure.create", "structureCreate"], ["structure.rename", "structureRename"],
  ["structure.close", "structureClose"], ["structure.reopen", "structureReopen"],
  // G4-05 (spec §5 O1): an existing room marked or unmarked as an isolation room — Yapı's fifth.
  ["structure.isolation", "structureIsolation"],
```

In `dashboard/src/live/i18n/strings/denetim.js`, find:

```js
      structureClose: "Yapı: kapatıldı", structureReopen: "Yapı: yeniden açıldı",
```

Replace with:

```js
      structureClose: "Yapı: kapatıldı", structureReopen: "Yapı: yeniden açıldı",
      structureIsolation: "Yapı: izolasyon odası değişti",                                          // G4-05 (spec §5 O1)
```

Then find:

```js
      structureClose: "Struktur: bağlandı", structureReopen: "Struktur: yenidən açıldı",
```

Replace with:

```js
      structureClose: "Struktur: bağlandı", structureReopen: "Struktur: yenidən açıldı",
      structureIsolation: "Struktur: izolyasiya otağı dəyişdi",
```

Then find:

```js
      structureClose: "Структура: закрыто", structureReopen: "Структура: открыто снова",
```

Replace with:

```js
      structureClose: "Структура: закрыто", structureReopen: "Структура: открыто снова",
      structureIsolation: "Структура: изолятор изменён",
```

Then find:

```js
      structureClose: "Structure: closed", structureReopen: "Structure: reopened",
```

Replace with:

```js
      structureClose: "Structure: closed", structureReopen: "Structure: reopened",
      structureIsolation: "Structure: isolation room changed",
```

- [ ] **Step 4: Run them to see them pass**

Run: `cd /c/tmp/g4-enfeksiyon/dashboard && npx vitest run src/live/screens/admin/StructureTab.test.jsx src/live/screens/denetim src/live/i18n`
Expected: with the engine's Task 5 in: `Test Files  19 passed (19)`, `Tests  216 passed (216)`. With the engine still at Task 1: `2 failed | 214 passed (216)` — `engineTypes.test.js` «finds every way the engine writes a type, …» and «names no type the engine does not write …», both green once Task 5 is in (N12).

- [ ] **Step 5: Commit**

```bash
cd /c/tmp/g4-enfeksiyon && git add dashboard/src/live/screens/admin/StructureTab.jsx dashboard/src/live/screens/admin/StructureTab.test.jsx dashboard/src/live/i18n/strings/kabul.js dashboard/src/live/screens/denetim/denetim.js dashboard/src/live/i18n/strings/denetim.js dashboard/src/live/screens/denetim/denetim.test.js dashboard/src/live/screens/denetim/engineTypes.test.js && git commit -m "feat(admin): G4-05 Yapı marks or unmarks an existing room as an isolation room (PATCH is_isolation, the tab's own write and notice); structure.isolation labelled on «Denetim bütünlüğü» (EVENT_TYPES 62)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- dashboard/src/live/screens/admin/StructureTab.jsx dashboard/src/live/screens/admin/StructureTab.test.jsx dashboard/src/live/i18n/strings/kabul.js dashboard/src/live/screens/denetim/denetim.js dashboard/src/live/i18n/strings/denetim.js dashboard/src/live/screens/denetim/denetim.test.js dashboard/src/live/screens/denetim/engineTypes.test.js
```

---

## Task 15 (dashboard): the device door's refusal of an isolation flag, in the reader's words (§5 M8)

**Files:**
- Modify: `dashboard/src/live/apiErrors.js` (`API_MESSAGE_KEYS`, after `deviceTokenOnly`)
- Modify: `dashboard/src/live/i18n/strings/errors.js` (four languages: `isolationFromDevice`)
- Test: `dashboard/src/live/apiErrors.test.js` (a test in `apiErrorText`'s block)

- [ ] **Step 1: Write the failing test**

In `dashboard/src/live/apiErrors.test.js`, find:

```js
  // G2-B5b: «Ertele»'s refusals (POST /alerts/snooze), pinned here as well as by the sweep above, which finds them in
```

Replace with:

```js
  // G4-05 (spec §5 M8): POST /ingest refuses an isolation flag from a device. Pinned here as well as by the sweep above,
  // which finds it in api/app.py only once the engine's half of the slice is in the same tree.
  it("says the device door's refusal of an isolation flag in the reader's words", () => {
    const sentence = "izolasyon bir klinisyen kaydıdır; cihazdan alınmaz";
    expect(apiErrorKey(new Error(sentence))).toEqual({ key: "errors.isolationFromDevice", vars: {} });
    expect(apiErrorText(createTranslator("tr", DICTIONARIES), Object.assign(new Error(sentence), { status: 400 })))
      .toBe("İzolasyon bir klinisyenin kaydıdır; cihazdan alınmaz.");
    expect(apiErrorText(az, Object.assign(new Error(sentence), { status: 400 })))
      .toBe("İzolyasiya klinisistin qeydidir; cihazdan qəbul edilmir.");
    expect(apiErrorText(en, Object.assign(new Error(sentence), { status: 400 })))
      .toBe("Isolation is a clinician's record; it is not taken from a device.");
  });

  // G2-B5b: «Ertele»'s refusals (POST /alerts/snooze), pinned here as well as by the sweep above, which finds them in
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd /c/tmp/g4-enfeksiyon/dashboard && npx vitest run src/live/apiErrors.test.js`
Expected: `Tests  1 failed | 300 passed (301)` — «says the device door's refusal of an isolation flag in the reader's words».

- [ ] **Step 3: Map the sentence**

In `dashboard/src/live/apiErrors.js`, find:

```js
  ["ingest requires a device token", "deviceTokenOnly"],
```

Replace with:

```js
  ["ingest requires a device token", "deviceTokenOnly"],
  // POST /ingest (G4-05, spec §5 M8): the four isolation flags come from a person, never from a device.
  ["izolasyon bir klinisyen kaydıdır; cihazdan alınmaz", "isolationFromDevice"],
```

In `dashboard/src/live/i18n/strings/errors.js`, find:

```js
    retractNotBedside: "Yalnız yatak başı ölçümü ve sıvı girişi hatalı giriş olarak işaretlenebilir.",
```

Replace with:

```js
    retractNotBedside: "Yalnız yatak başı ölçümü ve sıvı girişi hatalı giriş olarak işaretlenebilir.",
    isolationFromDevice: "İzolasyon bir klinisyenin kaydıdır; cihazdan alınmaz.",                // G4-05 (spec §5 M8)
```

Then find:

```js
    retractNotBedside: "Yalnız çarpayı başında ölçmə və maye qeydi səhv qeyd kimi işarələnə bilər.",
```

Replace with:

```js
    retractNotBedside: "Yalnız çarpayı başında ölçmə və maye qeydi səhv qeyd kimi işarələnə bilər.",
    isolationFromDevice: "İzolyasiya klinisistin qeydidir; cihazdan qəbul edilmir.",
```

Then find:

```js
    retractNotBedside: "Ошибочной записью можно отметить только прикроватное измерение и запись жидкости.",
```

Replace with:

```js
    retractNotBedside: "Ошибочной записью можно отметить только прикроватное измерение и запись жидкости.",
    isolationFromDevice: "Изоляцию отмечает клиницист; от устройства она не принимается.",
```

Then find:

```js
    retractNotBedside: "Only a bedside measurement or a fluid entry can be marked as entered in error.",
```

Replace with:

```js
    retractNotBedside: "Only a bedside measurement or a fluid entry can be marked as entered in error.",
    isolationFromDevice: "Isolation is a clinician's record; it is not taken from a device.",
```

- [ ] **Step 4: Run it to see it pass**

Run: `cd /c/tmp/g4-enfeksiyon/dashboard && npx vitest run src/live/apiErrors.test.js src/live/i18n`
Expected: `Test Files  14 passed (14)`, `Tests  412 passed (412)` — 413 once the engine's Task 2 is in: the sweep draws one test per message, the new one included.

- [ ] **Step 5: Commit**

```bash
cd /c/tmp/g4-enfeksiyon && git add dashboard/src/live/apiErrors.js dashboard/src/live/i18n/strings/errors.js dashboard/src/live/apiErrors.test.js && git commit -m "feat(i18n): G4-05 /ingest's refusal of an isolation flag from a device, mapped and said in four languages (spec §5 M8)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- dashboard/src/live/apiErrors.js dashboard/src/live/i18n/strings/errors.js dashboard/src/live/apiErrors.test.js
```

---

## Task 16 (dashboard): the `/enfeksiyon` route, the pinned tail, the rawKeys sweep

**Files:**
- Modify: `dashboard/src/live/shell/routes.js` (the lazy line, `SCREENS`, `ROUTES`)
- Test: `dashboard/src/live/shell/routes.test.js` (the workload block's tail, a new block)
- Test: `dashboard/src/live/rawKeys.test.jsx` (an import, the fixture card's isolation, the sweep's mock, an anchor)

- [ ] **Step 1: Write the failing route tests: the pinned tail moves to the new last route**

In `dashboard/src/live/shell/routes.test.js`, find:

```js
// gives one. A work screen, after the quality indicators, so nobody's home moves. THE ONE PINNED TAIL of the table is
// here: a slice that adds a route after «isyuku» edits this line and no other.
// The order: devir → eczane → ozet → kalite → isyuku → settings.
```

Replace with:

```js
// gives one. A work screen, after the quality indicators, so nobody's home moves. G4-05 put «Enfeksiyon kontrol» after
// it; the table's one pinned tail is in that route's block now.
```

Then find:

```js
    expect(screenOf(isyuku())).not.toBeNull();
    expect(ROUTES.map((r) => r.id).slice(-5)).toEqual(["eczane", "ozet", "kalite", "isyuku", "settings"]);
```

Replace with:

```js
    expect(screenOf(isyuku())).not.toBeNull();
    const ids = ROUTES.map((r) => r.id);
    expect(ids[ids.indexOf("isyuku") + 1]).toBe("enfeksiyon");
```

Then find:

```js
  it("is a work screen: a group given either key alone signs in to it and lands on it", () => {
    for (const key of ["workload.view", "shifts.manage"]) {
      expect(hasWorkRoute([key]), key).toBe(true);
      expect(homePath([key]), key).toBe("/is-yuku");
    }
  });
});
```

Replace with:

```js
  it("is a work screen: a group given either key alone signs in to it and lands on it", () => {
    for (const key of ["workload.view", "shifts.manage"]) {
      expect(hasWorkRoute([key]), key).toBe(true);
      expect(homePath([key]), key).toBe("/is-yuku");
    }
  });
});

// G4-05 (spec D2, D13, §5 M1): «Enfeksiyon kontrol» — for `infection.view`: the default attending, unit-physician,
// physician, charge-nurse and nurse groups hold it (migration 0023), the system administrator by rule. A work screen,
// after «İş yükü», so nobody's home moves. Its icon is `thermo`, which no other route has. THE ONE PINNED TAIL of the
// table is here: a slice that adds a route after «enfeksiyon» edits this line and no other.
// The order: devir → eczane → ozet → kalite → isyuku → enfeksiyon → settings.
describe("the infection-control page's route", () => {
  afterEach(() => resetScreens());
  const enfeksiyon = () => ROUTES.find((r) => r.id === "enfeksiyon");
  /** The default nurse and physician groups, as the engine seeds them since G4-05 (auth/permissions.py). */
  const NURSE_GROUP = ["board.view", "alerts.ack", "admissions.view", "admissions.admit", "admissions.transfer.confirm",
    "handover.sign", "clinical.chart", "beds.release", "tasks.view", "tasks.manage", "infection.view"];
  const PHYSICIAN = ["board.view", "alerts.ack", "alerts.escalate", "admissions.view", "handover.sign", "break_glass.use",
    "clinical.chart", "scores.sign", "tasks.view", "tasks.manage", "pharmacy.view", "infection.view"];
  const PHARMACIST = ["board.view", "admissions.view", "pharmacy.view"];
  const AUDITOR = ["board.view", "audit.view", "quality.view"];

  it("is a work screen for infection.view, on the main rail, with an icon no other route has, and its names", () => {
    expect(enfeksiyon()).toMatchObject({ path: "/enfeksiyon", perms: ["infection.view"], work: true, nav: "main",
      icon: "thermo", labelKey: "enfeksiyon.nav", shortKey: "enfeksiyon.navShort" });
    expect(screenOf(enfeksiyon())).not.toBeNull();
    expect(ROUTES.filter((r) => r.icon === "thermo").map((r) => r.id)).toEqual(["enfeksiyon"]);
    expect(ROUTES.map((r) => r.id).slice(-6)).toEqual(["eczane", "ozet", "kalite", "isyuku", "enfeksiyon", "settings"]);
    expect(["tr", "az", "ru", "en"].map((lang) => DICTIONARIES[lang]["enfeksiyon.nav"]))
      .toEqual(["Enfeksiyon kontrol", "İnfeksiya nəzarəti", "Инфекционный контроль", "Infection control"]);
  });

  it("is the ward's clinicians', moves nobody's home, and is neither the pharmacist's nor the auditor's", () => {
    for (const perms of [NURSE_GROUP, PHYSICIAN, ADMIN]) {
      expect(navRoutes(perms).main.map((r) => r.id), perms.join(",")).toContain("enfeksiyon");
      expect(homePath(perms), perms.join(",")).toBe("/beds");
    }
    for (const perms of [PHARMACIST, AUDITOR, NURSE]) expect(canReach(enfeksiyon(), perms), perms.join(",")).toBe(false);
  });

  it("is a work screen: a group given infection.view alone signs in to it and lands on it", () => {
    expect(hasWorkRoute(["infection.view"])).toBe(true);
    expect(homePath(["infection.view"])).toBe("/enfeksiyon");
  });
});
```

- [ ] **Step 2: Write the failing rawKeys anchor and the sweep's mock**

In `dashboard/src/live/rawKeys.test.jsx`, find:

```js
import { answer as pharmacyAnswer } from "./screens/eczane/eczane.testutil.js"; // G3-04
```

Replace with:

```js
import { answer as pharmacyAnswer } from "./screens/eczane/eczane.testutil.js"; // G3-04
import { answer as infectionAnswer, tree as infectionTree } from "./screens/enfeksiyon/enfeksiyon.testutil.js"; // G4-05
```

Then find:

```js
    meds: {
      pressors: { norepinephrine: 0.08 }, antibiotic_given: true, antibiotic_at: ago(600),
      antibiotic_clock: null, weight_kg: 72, creatinine: 1.9,
    },
  }),
```

Replace with:

```js
    meds: {
      pressors: { norepinephrine: 0.08 }, antibiotic_given: true, antibiotic_at: ago(600),
      antibiotic_clock: null, weight_kg: 72, creatinine: 1.9,
    },
    // G4-05: in isolation, so the patient screen's «İzolasyon» box draws its types and its last record.
    isolation: { contact: true, droplet: true, airborne: false, protective: null, types: ["contact", "droplet"],
      state: "isolated", charted_at: ago(900) },
  }),
```

Then find:

```js
      api.shiftNurses.mockResolvedValue(NURSES_SWEEP);
```

Replace with:

```js
      api.shiftNurses.mockResolvedValue(NURSES_SWEEP);

      // G4-05: «Enfeksiyon kontrol» (screens/enfeksiyon) — the isolated, the suspected, who lies on each bed.
      api.infection.mockResolvedValue(infectionAnswer());
```

Then find:

```js
  // G4-01 — «Cihaz & Veri Akışı»: the device page's sections on a ward with a silent, a vanished and a stale-channel
```

Replace with:

```js
  // G4-05 — «Enfeksiyon kontrol»: its cards, both tables and the isolation beds in every tile state (on a tree with an
  // isolation room), then the patient screen's «İzolasyon» box on the fixture's isolated card.
  it("the infection-control page's keys resolve on its cards, tables and tiles, and on the patient's isolation box", async () => {
    let mounted = await openAt("/enfeksiyon", (api) => api.structure.mockResolvedValue(infectionTree()));
    expect(screen.getByRole("heading", { level: 1, name: "İnfeksiya nəzarəti" })).toBeInTheDocument();       // enfeksiyon.title
    expect(screen.getByRole("table", { name: "İzolyasiyadakı xəstələr: 4" })).toBeInTheDocument();             // .isolated.caption
    expect(screen.getByRole("table", { name: "Şübhəli infeksiya və ya sepsis siqnalı: 4 xəstə" })).toBeInTheDocument();
    expect(screen.getByText("strukturda boş · paneldə xəstə var")).toBeInTheDocument();                        // .beds.tile.conflict
    expect(screen.getAllByText("Septik şok meyarları ödənilib").length).toBeGreaterThan(0);                    // .kind.septicShock
    expect(screen.getByText("3 xəstədə izolyasiya qeydi yoxdur")).toBeInTheDocument();                         // .count.isolationUnrecorded
    expect(rawKeys(document.body)).toEqual([]);
    expect(document.body.textContent).not.toMatch(UUID_TEXT);
    act(() => { mounted.board.clear(); });
    cleanup();
    mounted = await openAt(`/patients/${FIXTURE_ID}`);
    expect(screen.getByText("İzolyasiya: Təmas · Damcı")).toBeInTheDocument();                                 // patient.isolation.isolated
    expect(rawKeys(document.body)).toEqual([]);
    act(() => { mounted.board.clear(); });
  });

  // G4-01 — «Cihaz & Veri Akışı»: the device page's sections on a ward with a silent, a vanished and a stale-channel
```

- [ ] **Step 3: Run them to see them fail**

Run: `cd /c/tmp/g4-enfeksiyon/dashboard && npx vitest run src/live/shell/routes.test.js src/live/rawKeys.test.jsx`
Expected: `Tests  5 failed | 70 passed (75)` — the workload block's «is a work screen for workload.view or shifts.manage, …» (the route after `isyuku` is still `settings`), the new block's three tests (no `enfeksiyon` route), and the new rawKeys anchor (no page at `/enfeksiyon` yet).

- [ ] **Step 4: Add the route**

In `dashboard/src/live/shell/routes.js`, find:

```js
const IsYukuScreen = lazyScreen(() => import("../screens/isyuku/IsYukuScreen.jsx"), "IsYukuScreen"); // G4-04
```

Replace with:

```js
const IsYukuScreen = lazyScreen(() => import("../screens/isyuku/IsYukuScreen.jsx"), "IsYukuScreen"); // G4-04

const EnfeksiyonScreen = lazyScreen(() => import("../screens/enfeksiyon/EnfeksiyonScreen.jsx"), "EnfeksiyonScreen"); // G4-05
```

Then find:

```js
  isyuku: IsYukuScreen, // G4-04 — «İş yükü»: per unit this shift, the nurse cards, the charge nurse's assignment; no patient
```

Replace with:

```js
  isyuku: IsYukuScreen, // G4-04 — «İş yükü»: per unit this shift, the nurse cards, the charge nurse's assignment; no patient

  enfeksiyon: EnfeksiyonScreen, // G4-05 — «Enfeksiyon kontrol»: isolation, suspected infection, the antibiotic clock, sepsis alarms, the isolation beds
```

Then find:

```js
  route({ id: "isyuku", path: "/is-yuku", icon: "users", labelKey: "isyuku.nav", shortKey: "isyuku.navShort",
    perms: ["workload.view", "shifts.manage"], work: true, nav: "main" }),
```

Replace with:

```js
  route({ id: "isyuku", path: "/is-yuku", icon: "users", labelKey: "isyuku.nav", shortKey: "isyuku.navShort",
    perms: ["workload.view", "shifts.manage"], work: true, nav: "main" }),

  // G4-05 (spec D2, D13, §5 M1) — «Enfeksiyon kontrol»: for whoever holds `infection.view` — the default attending,
  // unit-physician, physician, charge-nurse and nurse groups (migration 0023), the system administrator by rule. A work
  // screen; after «İş yükü», so nobody's home moves. `thermo`: used by no other route (`shield` is the administration's).
  route({ id: "enfeksiyon", path: "/enfeksiyon", icon: "thermo", labelKey: "enfeksiyon.nav", shortKey: "enfeksiyon.navShort",
    perms: ["infection.view"], work: true, nav: "main" }),
```

- [ ] **Step 5: Run the route, sweep and boundary tests to see them pass**

Run: `cd /c/tmp/g4-enfeksiyon/dashboard && npx vitest run src/live/shell src/live/rawKeys.test.jsx src/live/boundaries.test.js src/live/LiveApp.test.jsx`
Expected: `Test Files  7 passed (7)`, `Tests  198 passed (198)`.

- [ ] **Step 6: Commit**

```bash
cd /c/tmp/g4-enfeksiyon && git add dashboard/src/live/shell/routes.js dashboard/src/live/shell/routes.test.js dashboard/src/live/rawKeys.test.jsx && git commit -m "feat(shell): G4-05 /enfeksiyon «Enfeksiyon kontrol» for infection.view, a work screen after isyuku (icon thermo); the pinned tail moves to its block; the rawKeys sweep reads GET /infection and anchors the page's and the isolation box's words" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- dashboard/src/live/shell/routes.js dashboard/src/live/shell/routes.test.js dashboard/src/live/rawKeys.test.jsx
```

The dashboard lane is done: report the nine shas to the coordinator.

---

# Docs and gates

## Task 17 (docs, after both lanes): the guide, §3.28

**Files:**
- Modify: `docs/homunculus-rehber-TR.md` (§3.5 «İzin»; after §3.27, before the `---` that precedes «## 4.»)

- [ ] **Step 1: The permission count**

In `docs/homunculus-rehber-TR.md`, find:

```markdown
- *Homunculus'ta:* 30 sabit anahtar (`board.view`, `alerts.ack`, `users.manage`, `groups.manage`…; en yenisi
  `workload.view`, «İş yükü», §3.26).
```

Replace with:

```markdown
- *Homunculus'ta:* 31 sabit anahtar (`board.view`, `alerts.ack`, `users.manage`, `groups.manage`…; en yenisi
  `infection.view`, «Enfeksiyon kontrol», §3.28).
```

- [ ] **Step 2: §3.28**

Then find:

```markdown
- **Kaynak:** `docs/superpowers/specs/2026-11-11-g3-cihaz-olcum-kaydi-design.md` (§11 «As built»); plan
  `docs/superpowers/plans/2026-11-11-g3-cihaz-olcum-kaydi.md`.

---

## 4. "Neden bunu kullanmıyoruz" köşesi
```

Replace with:

```markdown
- **Kaynak:** `docs/superpowers/specs/2026-11-11-g3-cihaz-olcum-kaydi-design.md` (§11 «As built»); plan
  `docs/superpowers/plans/2026-11-11-g3-cihaz-olcum-kaydi.md`.

### 3.28 «Enfeksiyon kontrol»: izolasyon, şüpheli enfeksiyon, antibiyotik süresi ve sepsis alarmları (Grup 4 · G4-05)

- **Ne:** Sol raydaki **«Enfeksiyon kontrol»** sayfası (`/enfeksiyon`; Azerbaycanca «İnfeksiya nəzarəti», Rusça
  «Инфекционный контроль», İngilizce «Infection control»). Birim birim: kim izolasyonda ve nerede, kimde şüpheli
  enfeksiyon ya da sepsis alarmı var ve antibiyotik süresi ne durumda, izolasyon yatakları ne halde. Yalnız okur;
  sayfadan hiçbir şey yazılmaz. Hasta adları görünür (sayfayı açan her varsayılan grup birimin klinisyenidir).
  Örneklerdeki adlar ve sayılar uydurmadır.
- **Durum:** kodda (`feat/g4-enfeksiyon`); main'e ve hastane sunucusuna sahibin sözüyle çıkar. Sunucuda göç `0023`
  çalışmalıdır.
- **Kim görür:** yeni yetki `infection.view` («“Enfeksiyon kontrol” sayfasını açar …»). Varsayılan **Sorumlu Hekim**,
  **Ünite Hekimi**, **Hekim**, **Sorumlu Hemşire** ve **Hemşire** grupları taşır (göç `0023` var olan hastanelere verir;
  sonra kurulan bir hastanenin grupları kendiliğinden taşır); Sistem Yöneticisi her yetkiyi kural gereği taşır; Eczacı,
  Hızlı Yanıt Ekibi, Denetçi, Üretici Destek ve Biyomedikal taşımaz; başka bir gruba Yönetim › Roller ve
  yetkiler'den verilebilir. Bir çalışma ekranıdır: yalnız bu yetkiyi taşıyan bir hesap bununla oturum açar ve girişte
  bu sayfaya düşer. Rayda «İş yükü»nden sonra gelir; kimsenin giriş sayfası değişmedi. Satırdaki yatak ve ad, `board.view`
  taşıyana hasta ekranını açar. İzolasyon yatakları yapıdan okunur: bir kabul ya da yapı yetkisi gerekir (beş varsayılan
  grubun hepsi `admissions.view` taşır); yoksa o bölüm «— yapı okunamıyor» der, sayfanın kalanı durur.
- **Sayfanın sırası (yukarıdan aşağı):**
  1. **Başlık:** «Enfeksiyon kontrol», «İzolasyon, şüpheli enfeksiyon, antibiyotik süresi ve sepsis alarmları», taze
     yanıtın saati («09:30 itibarıyla»), **«Birim»** seçici («Tüm birimler» ya da bir birim; yapıdaki açık birimler ve
     listedeki birimler) ve «Yenile». Seçilen birim yeni okumada artık yoksa seçici «Tüm birimler»e döner ve «Seçili
     birim artık kapsamınızda değil.» der. Birimi belli olmayan bir hasta yalnız «Tüm birimler»de görünür, sunucu onu
     orada sayar.
  2. **Kartlar:** «izolasyonda kayıtlı hasta» (altında «{n} hastada izolasyon kaydı yok»), «boş izolasyon yatağı»
     («1 / 10»), «şüpheli enfeksiyon işaretli hasta» (altında «{n} hastada işaret yok»), «antibiyotik süresi aşan» ve
     «sepsis alarmı süren hasta» (altında «yanıtlanmış ya da yanıtlanmamış»: sayı, alarmı süren hastadır; geçmiş ama
     onaylanmamış alarm listede görünür, sayılmaz).
  3. **«İzolasyondaki hastalar»:** Yatak · hasta, Birim, İzolasyon (türler etiket olarak — Temas, Damlacık, Solunum,
     Koruyucu — ve «son kayıt 08:10»), Oda («izolasyon odası» / «izolasyon odasında değil»; yatağı yoksa «— yatağı
     bilinmiyor», yapıda bulunmayan bir yatak için «— yatak yapıda bulunamadı»). Birim adına, sonra yatak adına göre
     sıralıdır; birimi olmayan en sonda. Altında: «İzolasyon, bir klinisyenin hasta ekranından bu sisteme kaydettiği
     önlem türleridir; sistem izolasyon önermez, türünü seçmez. “İzolasyon kaydı yok”, kayıt yapılmadığını söyler;
     hastanın izolasyonda olmadığı anlamına gelmez.»
  4. **«İzolasyon yatakları» · «{a} dolu · {b} boş»:** yapıda izolasyon odası işaretli her açık odanın her açık yatağı
     (Doluluk'un da okuduğu ağaç): «boş», «izolasyonlu hasta» (ad ve türler), «izolasyonsuz hasta», «izolasyon kaydı
     yok», «dolu — hasta bu listede yok» (yatakta biri var ama kapsamınızda değil), «temizlikte», «rezerve», «kullanım
     dışı» (neden yazılmaz: neden Doluluk'ta), «bakımda». Yapı yatağı boş derken panoda üstünde hasta varsa (HBYS yatak
     eşlemesi) kutu «yapıda boş · panoda hasta var» der, asla yalnız «boş» demez; böyle yatak ne boş ne dolu sayılır.
     Hiçbir kutu yargı rengi taşımaz.
  5. **«Şüpheli enfeksiyon»:** şüpheli enfeksiyon işaretli ya da Sepsis-3 alarmı (septik şok, sepsis, yeterli sıvıdan
     önce hipoperfüzyon) olan her hasta — işaret sonradan «yok» yapılsa da alarmı listede kalır. Önce süresi işleyen ya
     da aşan antibiyotik (en az kalan önde), sonra alarmı süren, sonra kalanlar. Antibiyotik hücresi Eczane'ninkinin
     aynısıdır. Alarm türleri ölçüt diliyle yazılır: «Septik şok ölçütleri karşılandı», «Sepsis ölçütleri karşılandı»,
     «Yeterli sıvıdan önce hipoperfüzyon» — tanı değil; «geçti · onaylanmadı», «onaylandı», «ertelendi · bitiş 10:15»
     eklenir. Altında Eczane'nin iki satırı (“Kayıt yok” ne demek; 1 saatlik antibiyotik penceresi ve kaynağı).
  6. **Bu sayfada yok:** cihaz günleri (santral kateter, üriner kateter, ventilatör), cihaz kullanım oranı, enfeksiyon
     oranları, antibiyotik günü ve kültür sonuçları — hiçbirinin bu sistemde kaynak kaydı yok, hiçbiri hesaplanmadı.
     Enfeksiyon tanımı ve olay sayımı bu sistemin işi değildir; sistem eşik ya da tanım üretmez. Tasarım prototipindeki
     sayılar ve iki formül (kullanım oranı, 1000 cihaz gününde oran) taşınmadı.
- **Her sayı ya gerçektir ya da neden yok olduğunu söyler.** Liste 30 saniyede bir okunur (Eczane gibi; sekme
  görünmüyorsa okunmaz, görününce hemen okunur) ve yapı her okumada yeniden okunur. Son yanıt 90 saniyeden eskiyse kırmızı
  «Enfeksiyon listesi güncel değil · son yanıt 09:31» çıkar: 0'dan büyük sayılar «son yanıt … itibarıyla» kalır, 0
  olanlar ve «boş», «izolasyonsuz», «kayıt yok» diyecek her kutu «— liste güncel değil» olur; boş liste cümleleri
  («Kapsamınızda izolasyonda kayıtlı hasta yok.») yalnız taze yanıtla yazılır. İlk okuma olmadıysa ya da yetki
  reddedildiyse sayfada kart, tablo, kutu ve ad kalmaz.
- **Hasta ekranında «İzolasyon» kutusu:** Sepsis kutusunun altında (dar ekranda Sepsis, İzolasyon, İlaç sırasıyla).
  Durum satırı üç şeyden birini söyler: «İzolasyon: Temas · Damlacık», «Açık izolasyon kaydı yok: son kayıtta hiçbir tür
  işaretli değil.» ya da «İzolasyon kaydı yok: bu hasta için bu sisteme hiç izolasyon kaydedilmedi.» — kayıt yoksa
  «izolasyonda değil» denmez. Altında «Son kayıt: 08:10» (kimin kaydettiği «Denetim bütünlüğü»nde, dört `chart`
  satırında). `clinical.chart` taşıyan dört türü işaretler ve **«İzolasyonu kaydet»**e basar: dört tür birlikte, saatsiz
  (sunucunun anı) kaydedilir; denetim kaydına adıyla yazılır. Geri alınmaz — yeni kayıt üstüne yazar; izolasyonu
  bitirmek için dört işaret kaldırılıp kaydedilir. Hiç kayıt yokken dört işaret boşsa düğme «İzolasyon yok olarak
  kaydet» der. Pano canlı değilken kayıt yapılmaz («Pano güncel değil — kayıt için panonun yeniden bağlanmasını
  bekleyin.») ve «yok» diyen cümle yazılmaz. İşaretlere dokunduktan sonra başka biri yeni bir kayıt yaptıysa
  kaydetmeden önce kutu bunu söyler: «Yine de kaydet» ya da «Seçimden vazgeç». Yanlış hastaya işaretlenen bir izolasyon
  «izolasyon yok» olarak düzeltilebilir, asla «kayıt yok»a geri dönmez.
- **İzolasyonu yalnız bir kişi kaydeder:** cihaz kapısı (`POST /ingest`) dört izolasyon kodunu reddeder (400 «izolasyon
  bir klinisyen kaydıdır; cihazdan alınmaz»); ne motora, ne denetim kaydına, ne ölçüm kaydına, ne eşleşmeyen listesine
  gider. Monitör ya da HBYS izolasyon belirleyemez.
- **Yönetim › Yapı'da oda izolasyon işareti:** var olan bir oda artık «İzolasyon odası yap» / «İzolasyon işaretini
  kaldır» ile işaretlenir ya da işareti kaldırılır (`structure.manage`). Her değişiklik denetim kaydına
  `structure.isolation` olarak yazılır («Denetim bütünlüğü»nde «Yapı: izolasyon odası değişti»). Bu dilimden önce
  işaret yalnız oda kurulurken verilebiliyordu; yapısı işaretsiz kurulmuş bir hastanede yatak bölümü, odalar
  işaretlenene kadar «Kapsamınızda izolasyon odası tanımlı değil.» der.
- **Sunucuda:**
  - dört yeni klinik alan: `isolation_contact`, `isolation_droplet`, `isolation_airborne`, `isolation_protective` (0 ya da
    1; saat gönderilirse en çok 24 saat geri, ileri değil); hiçbir kural okumaz; «hatalı giriş» ile geri alınmaz ve ölçüm
    kaydına yazılmaz;
  - pano kartında `isolation` bloğu (dört tür, durum sözcüğü, son kaydın saati; kişi yok);
  - yeni `GET /infection` (`infection.view`): kapsamdaki kartlardan iki liste, yataktaki hastalar ve sayılar; denetim
    kaydına yazılmaz;
  - göç `0023`: beş grubun `infection.view` satırı; tablo yok. Önceki imaj bu göçle açılmaz: geri dönüşte önce bu
    sürümün imajıyla `alembic downgrade` sunucunun sürümden önceki başına (birleşik bir çıkışta o başa), sonra eski
    imaj.
- **Kurulum notu:** api ve web birlikte çıkar, `alembic upgrade head` ile (0023 yalnız satır yazar). Web api'den önce
  çıkmaz: eski api yeni kodları «bilinmeyen klinik alan» diye reddeder ve `/infection`'ı tanımaz. Yetkiler oturum
  açılışında alınır: dağıtımdan önce açılmış bir oturum sayfayı token yenilenince görür.
- **Bu dilimde olmayanlar:** cihaz günleri, cihaz kullanım oranı, enfeksiyon oranları, antibiyotik günü, kültürler ve
  formülleri; izolasyon önerisi, eşik ya da kültür veya tanı ile izolasyon türü arasında bağ; yatak kartlarında, alarm
  satırlarında ya da Doluluk'ta izolasyon etiketi; izolasyon nedeni ya da serbest metin; izolasyon geçmişi ekranı;
  izolasyonun yatak atamasında ya da nakilde kullanılması; bildirim; yazdırma ya da dışa aktarma.
- **Açık:** Azerbaycanca, Rusça ve İngilizce metinler yerel okuma bekliyor.
- **Kaynak:** `docs/superpowers/specs/2026-11-12-g4-enfeksiyon-design.md` (§5 değişiklikleriyle); plan
  `docs/superpowers/plans/2026-11-12-g4-enfeksiyon.md`.

---

## 4. "Neden bunu kullanmıyoruz" köşesi
```

- [ ] **Step 3: Check it**

Run: `cd /c/tmp/g4-enfeksiyon && grep -n "^### 3.2[6-8]\|^## 4\.\|31 sabit anahtar" docs/homunculus-rehber-TR.md`
Expected: one `31 sabit anahtar` line; then `### 3.26 «İş yükü» …`, `### 3.27 Cihaz ölçüm kaydı …`, `### 3.28 «Enfeksiyon kontrol» …` and `## 4. …`, in that order.

- [ ] **Step 4: Commit**

```bash
cd /c/tmp/g4-enfeksiyon && git add docs/homunculus-rehber-TR.md && git commit -m "docs(rehber): §3.28 «Enfeksiyon kontrol» (G4-05) — who sees it, the page from top to bottom, «—» with a reason, the patient's İzolasyon box, the device door's refusal, a room's isolation mark on Yapı, what the server does, the deploy note; 31 permission keys" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- docs/homunculus-rehber-TR.md
```

---

## Task 18: the gates (after Tasks 1–17)

**Files:** none. A failure goes back to the owning lane as a fix commit (pathspec, Co-Authored-By line); then the failed chunk is run again.

- [ ] **Step 1: The whole no-DB engine suite (Python 3.14, the venv's), in foreground chunks**

Run from `C:\tmp\g4-enfeksiyon\homunculus-engine`. Each line is one tool call with a timeout of at least 180000 ms; never run `test_infinity_vm_pilot.py`.

```bash
cd /c/tmp/g4-enfeksiyon/homunculus-engine && "/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest tests/test_a[a-l]*.py -q -p no:cacheprovider
cd /c/tmp/g4-enfeksiyon/homunculus-engine && "/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest tests/test_a[m-z]*.py -q -p no:cacheprovider
cd /c/tmp/g4-enfeksiyon/homunculus-engine && "/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest tests/test_b*.py -q -p no:cacheprovider
cd /c/tmp/g4-enfeksiyon/homunculus-engine && "/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest tests/test_[c-d]*.py -q -p no:cacheprovider
cd /c/tmp/g4-enfeksiyon/homunculus-engine && "/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest tests/test_[e-h]*.py -q -p no:cacheprovider
cd /c/tmp/g4-enfeksiyon/homunculus-engine && "/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest tests/test_infinity_[a-r]*.py -q -p no:cacheprovider
cd /c/tmp/g4-enfeksiyon/homunculus-engine && "/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest tests/test_infinity_[s-z]*.py --ignore=tests/test_infinity_vm_pilot.py -q -p no:cacheprovider
cd /c/tmp/g4-enfeksiyon/homunculus-engine && "/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest tests/test_identity.py tests/test_infection.py tests/test_infection_api.py tests/test_ingest_apply.py tests/test_integration_e2e.py tests/test_isolation_chart.py tests/test_[j-l]*.py -q -p no:cacheprovider
cd /c/tmp/g4-enfeksiyon/homunculus-engine && "/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest tests/test_[m-o]*.py -q -p no:cacheprovider
cd /c/tmp/g4-enfeksiyon/homunculus-engine && "/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest tests/test_[p-r]*.py -q -p no:cacheprovider
cd /c/tmp/g4-enfeksiyon/homunculus-engine && "/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest tests/test_[s-z]*.py tests/rules tests/scoring tests/tenant -q -p no:cacheprovider
```

Expected, no failure and no error:

| Chunk | Passed | Skipped |
|---|---|---|
| `test_a[a-l]*.py` | 319 | 255 |
| `test_a[m-z]*.py` | 618 | 245 |
| `test_b*.py` | 281 | 29 |
| `test_[c-d]*.py` | 164 | 298 |
| `test_[e-h]*.py` | 405 | 85 |
| `test_infinity_[a-r]*.py` | 345 | 0 |
| `test_infinity_[s-z]*.py` (without `test_infinity_vm_pilot.py`) | 545 | 0 |
| the other `test_i*.py` and `test_[j-l]*.py` | 504 | 29 |
| `test_[m-o]*.py` | 108 | 103 |
| `test_[p-r]*.py` | 635 | 140 |
| `test_[s-z]*.py`, `rules`, `scoring`, `tenant` | 646 | 347 |
| **Total** | **4570** | **1531** |

The skips are the DB-backed tests (no `TEST_DATABASE_URL` here). Six tests need the repository's git (`test_dev_waves_bench.py::test_a_scratch_folder_inside_a_repository_is_refused_before_anything_runs`, `test_dev_waves_replay.py::test_a_scratch_folder_inside_a_repository_is_refused_and_not_created`, three in `test_infinity_release.py`, one in `test_infinity_transport.py`): they pass in the worktree and fail in a copy without `.git` — a failure of one of them outside the worktree is not the slice's.

- [ ] **Step 2: The DB-backed tests the slice touches, on the throwaway Postgres**

One call each, each with a timeout of at least 180000 ms:

```bash
docker run -d --rm --name enfeksiyon-pg -p 127.0.0.1:56460:5432 -e POSTGRES_PASSWORD=ozet -e POSTGRES_DB=ozet postgres:16
timeout 60 bash -c 'until docker exec enfeksiyon-pg createdb -U postgres ozet_test 2>/dev/null; do :; done'
cd /c/tmp/g4-enfeksiyon/homunculus-engine && TEST_DATABASE_URL=postgresql+asyncpg://postgres:ozet@127.0.0.1:56460/ozet_test "/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest tests/test_migration_0023_infection_view.py tests/test_migration_0022_workload_view.py tests/test_migration_0021_vital_readings.py tests/test_migration_0019_pharmacy_view.py tests/test_migration_0010_schema_parity.py tests/test_audit_postgres.py -q -p no:cacheprovider
cd /c/tmp/g4-enfeksiyon/homunculus-engine && TEST_DATABASE_URL=postgresql+asyncpg://postgres:ozet@127.0.0.1:56460/ozet_test "/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest tests/test_permissions.py tests/test_groups_service.py tests/test_merge_permissions.py tests/test_route_permissions.py -q -p no:cacheprovider
cd /c/tmp/g4-enfeksiyon/homunculus-engine && TEST_DATABASE_URL=postgresql+asyncpg://postgres:ozet@127.0.0.1:56460/ozet_test "/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest tests/test_structure_api.py -q -p no:cacheprovider
cd /c/tmp/g4-enfeksiyon/homunculus-engine && TEST_DATABASE_URL=postgresql+asyncpg://postgres:ozet@127.0.0.1:56460/ozet_test "/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest tests/test_admin_api.py -k "group" -q -p no:cacheprovider
cd /c/tmp/g4-enfeksiyon/homunculus-engine && TEST_DATABASE_URL=postgresql+asyncpg://postgres:ozet@127.0.0.1:56460/ozet_test "/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest tests/test_admin_api.py -k "not group and user" -q -p no:cacheprovider
cd /c/tmp/g4-enfeksiyon/homunculus-engine && TEST_DATABASE_URL=postgresql+asyncpg://postgres:ozet@127.0.0.1:56460/ozet_test "/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest tests/test_admin_api.py -k "not group and not user" -q -p no:cacheprovider
cd /c/tmp/g4-enfeksiyon/homunculus-engine && TEST_DATABASE_URL=postgresql+asyncpg://postgres:ozet@127.0.0.1:56460/ozet_test "/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest tests/test_tenant_isolation.py -k "test_the_callers_own_object_by_id_gets_past_the_scoping" -q -p no:cacheprovider
cd /c/tmp/g4-enfeksiyon/homunculus-engine && TEST_DATABASE_URL=postgresql+asyncpg://postgres:ozet@127.0.0.1:56460/ozet_test "/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest tests/test_tenant_isolation.py -k "test_another_tenants_object_by_id_is_a_404_exactly_like_a_missing_one" -q -p no:cacheprovider
cd /c/tmp/g4-enfeksiyon/homunculus-engine && TEST_DATABASE_URL=postgresql+asyncpg://postgres:ozet@127.0.0.1:56460/ozet_test "/c/Users/User/Desktop/Project/Homunculus AI/homunculus-engine/.venv/Scripts/python.exe" -m pytest tests/test_tenant_isolation.py -k "not test_the_callers_own_object_by_id_gets_past_the_scoping and not test_another_tenants_object_by_id_is_a_404_exactly_like_a_missing_one" -q -p no:cacheprovider
docker stop enfeksiyon-pg
```

Expected: no failure and no error: `32 passed`; `81 passed`; `42 passed`; `28 passed, 42 deselected`; `13 passed, 57 deselected`; `29 passed, 41 deselected`; `38 passed, 94 deselected`; `38 passed, 94 deselected`; `56 passed, 76 deselected`. Report each `N passed` line as printed. Stop the container even if a test failed.

- [ ] **Step 3: The whole dashboard suite, in three foreground chunks**

Each line is one call with a timeout of at least 300000 ms:

```bash
cd /c/tmp/g4-enfeksiyon/dashboard && npx vitest run src/live/screens/patient
cd /c/tmp/g4-enfeksiyon/dashboard && npx vitest run src/live/screens/kabul src/live/screens/admin src/live/screens/common src/live/screens/devices src/live/screens/denetim src/live/screens/bedside src/live/screens/beds src/live/screens/ozet src/live/screens/isyuku src/live/screens/enfeksiyon src/live/screens/eczane src/live/screens/doluluk src/live/screens/rrt src/live/screens/kalite src/live/screens/gorevler src/live/screens/devir src/live/screens/settings src/live/screens/alarms
cd /c/tmp/g4-enfeksiyon/dashboard && npx vitest run src/live/ui src/live/i18n src/live/data src/live/auth src/live/theme src/live/shell src/live/session src/live/signals src/live/gallery src/live/rawKeys.test.jsx src/live/LiveApp.test.jsx src/live/apiErrors.test.js src/live/boundaries.test.js src/live/prefs.test.js src/live/waveBoundaries.test.js src/sepsisContext.test.js src/routing.test.js src/reachable.test.js src/liveConnection.test.js src/liveAuth.test.js src/liveAdapters.test.js src/devProxy.test.js src/buildSha.test.js src/backendApi.test.js src/backendApi.admin.test.js src/LoadFailed.test.jsx
```

Expected: `Test Files  24 passed (24)`, `Tests  645 passed (645)`; `Test Files  84 passed (84)`, `Tests  2047 passed (2047)`; `Test Files  75 passed (75)`, `Tests  2150 passed (2150)` — 183 files and 4842 tests in all. Two vitest runs at once on the shared `node_modules` junction can fail with «Vitest failed to find the current suite» — run again, it is not a code error.

- [ ] **Step 4: The build**

Run: `cd /c/tmp/g4-enfeksiyon/dashboard && npx vite build`
Expected: `✓ built`, no chunk over 500 kB and no `(!)` warning; a new `EnfeksiyonScreen-*.js` (≈ 13.7 kB, gzip ≈ 4.6 kB) and five chunks lifted out of others because two pages now share them — `enfeksiyon-*.js` (≈ 5.3 kB), `ozet-*.js` (≈ 8.8 kB), `pharmacyModel-*.js` (≈ 2.3 kB), `usePharmacy-*.js` (≈ 1.3 kB) and `numbers-*.js` (0.1 kB); `precache  79 entries` (73 before the slice: +6, plan note N17). `PatientScreen-*.js` ≈ 125 kB, `Toast-*.js` ≈ 25 kB, the two `i18n-*` chunks under 500 kB. `dist/` is git-ignored (`dashboard/.gitignore`).

- [ ] **Step 5: Nothing stray**

Run: `cd /c/tmp/g4-enfeksiyon && git status --short && git log --oneline ebadfb01..HEAD`
Expected: a clean tree. The log holds the plan's commit and the seventeen task commits (seven engine, nine dashboard, one docs), plus any fix commits, each named.

- [ ] **Step 6: Report** to the coordinator:
- the shas and the gate counts;
- what a reviewer should eyeball in a browser:
  - the page at 390 px: the cards wrap, the two tables scroll inside their frames, the tiles stack;
  - the rail at phone width with «Enfeksiyon» / «İnfeksiya» / «Инфекции» / «Infection»;
  - a session holding `infection.view` alone lands on `/enfeksiyon` and its bed section reads «— yapı okunamıyor»; a nurse lands on «Yataklar»;
  - the patient screen: the «İzolasyon» box under the Sepsis box (and between Sepsis and Meds at phone width), a save, a second tab's save before the press (the hold, «Yine de kaydet», «Seçimden vazgeç»), the board dropped to DEGRADED (no save, no «yok»);
  - Yönetim › Yapı: «İzolasyon odası yap» on a room, the tile appearing on the page, the `structure.isolation` row on «Denetim bütünlüğü»;
  - the az, ru and en wording, which await a native speaker before the pilot.

Do not push, do not merge, and send nothing to the VM.

---

## Self-review

**Spec coverage.**
- §1, D1, D19: the page shows what has a source — suspected infection, the antibiotic clock, the three Sepsis-3 kinds, isolation rooms and their occupancy — plus the one new record, the patient's isolation; the honesty note names what is not built (Tasks 8, 12). Nothing out of D19 is built.
- D2, D9: `infection.view` (the 31st), the five default groups, the system group by rule, the four mirrors (Tasks 1, 8); migration `0023` for the tenants seeded before (Task 7).
- D3, D7, §5 M8: the four codes — `CHARTABLE` "bool", `_BOOLEAN`, `ISOLATION_CODES`, the bedside time bound, not withdrawable, never in the record — and `/ingest`'s 400 before anything is written, mapped in four languages (Tasks 2, 15; N1).
- D8, §5 S2: the card's `isolation` block without a person, `null` on an identity-only card, restored by the existing chart replay (Task 3); carried by `liveAdapters` (Task 13).
- D10, §5 S1, A3, M3, M4: `GET /infection` — rows, `sort_group`, `bed_occupants`, `units`, the counts with `isolation_unrecorded` and `suspected_unrecorded`, latched alarms listed and not counted, the two new alarm fields, an identity-only card read defensively; no `beds` (Task 4; N3). D11 is withdrawn and not built.
- D12, §5 M6: `BOARD_EXPECTED` 29, `UNSCOPED_BY_DESIGN`, `API_PATHS` 36, nginx (Task 6); the vite proxy, `backendApi.infection()`, its test and mock (Task 9); `devProxy.test.js` holds the two together.
- D13, D15, §5 S1, A3, A4, A6, M1, M3, M4, M7: the page — header, the unit filter and its fallback, the five cards with their second lines, both tables in the page's order, the isolation beds from the tree (every tile state, the conflict, BLOCKED without a reason), the notes, Decision 18 per cell, the tree's own source (Tasks 10–12; N4–N7); the route after `isyuku` with `thermo` and the pinned tail (Task 16).
- D14, §5 M9: Eczane's 30 s, a hook of its own, `skewAtReceipt` moved, `usePharmacy.test.jsx` untouched, the tree reloaded with each read (Tasks 9, 10; N11).
- D16, §5 S2, A1, M2, M8: the «İzolasyon» box under the Sepsis box — state line, last record, four boxes, the answers, the hold, not LIVE, a patient switch; `patient.onlyWrite` six (Task 13; N9).
- D17, §5 O1: `RoomPatch.is_isolation`, `structure.isolation` (Task 5); Yapı's button, `EVENT_TYPES` 62, `engineTypes.test.js` (Task 14; N10).
- D18, §5 A6, M6, M8, O1: the `enfeksiyon` namespace, `patient.isolation.*`, `kabul.isolation*`, `denetim.type.structureIsolation`, `errors.isolationFromDevice`, the kinds in the criteria register, `rawKeys.test.jsx` (Tasks 8, 13–16). `AZ_SAME_AS_TR` gains nothing: every Azerbaijani text differs from its Turkish source.
- D20, D22, §5 A2, M5: §3.28 with the deploy and rollback notes and §3.5's count (Task 17); the roadmap row after the walk (N15); the migration's docstring (Task 7); the renumber list (N16).
- D21, §5 A2, M5: `0023` on `0021`, data only, the head by ancestry (Task 7; N13).
- §4 Tests and every amendment's own tests: each has a task above. S1 and S2 withdrew the `WardStructure`, `PostgresWardStructure`, `AckStore` and audit-read tests with the code they tested.

**Dry run.**
- Every edit block of this plan was applied, in order, by a script that reads the plan (`In <path>, find:`, `Then find:`, `Replace with:`, `Create <path> with:`) to a scratch copy of the worktree at `ebadfb01`: 121 blocks over 63 files, each find block found exactly once at its point, no error.
- Every step's stated result above was measured on the plan applied up to that step: the engine lane on one copy advanced step by step, the dashboard lane on a second copy with Tasks 2–7 left out (the engine at Task 1), and the cross-lane states of N12 both ways — the engine lane complete with the dashboard at Task 1, and the dashboard lane complete with the engine at Task 1.
- The gates on the whole plan: the engine's no-DB suite in Task 18's eleven chunks (4564 passed and 1531 skipped in the copy, plus the six git-bound tests below); the nine DB chunks on a throwaway `postgres:16` (32; 81; 42; 28; 13; 29; 38; 38; 56 passed); the whole dashboard suite (183 files, 4842 tests); `npx vite build` (precache 73 → 79; main's 73 checked on an untouched copy of `ebadfb01`).
- Not run in the scratch copy: the six tests that need the repository's git (Task 18 Step 1's note) — run in the worktree at `ebadfb01` instead, their four files whole: 94 passed; the slice touches none of their modules. Never run: `tests/test_infinity_vm_pilot.py` (the rule). No browser walk: the page and the box have been seen only through Testing Library (Task 18 Step 6 lists what to eyeball).

**Placeholder scan.** No TBD and no "similar to". Every step that changes code shows the code; every run states its command and its expected result.

**Type and name consistency.**
- Engine: `PERMISSIONS["infection.view"]`; `SignalCode.ISOLATION_CONTACT|DROPLET|AIRBORNE|PROTECTIVE`; `clinical.ISOLATION_CODES`; `board._isolation(state)` → `{contact, droplet, airborne, protective, types, state, charted_at}`; `infection.SEPSIS_KINDS`, `isolation_of(card)`, `suspected_of(card)`, `sepsis_alarms_of(card)`, `row_of(card)`, `counts_of(rows)`, `ward_infection(cards, *, now)`; `app.INFECTION_VIEW`; `RoomPatch.is_isolation`; `router._changes(…, was_isolation, is_isolation)`; migration `0023` `KEY`, `GROUPS`, `GRANT`, `REVOKE`; its test's `CHAIN`.
- Dashboard API: `api.infection()`; the `fakeApi` mock of the same name; `api.patchRoom(id, { is_isolation })`.
- `skewAtReceipt(api, answer)`, `SKEW_NOISE_MS`; `useInfection(store, { reloadStructure, everyMs })` → `{data, error, skewMs, refresh}`; `INFECTION_TICK_MS`; `isInfectionAnswer(answer)`.
- `enfeksiyon.js`: `ALL = "*"`, `TYPES`, `TILES`, `tileOf(state, occupants)`, `isolationBeds(tree, answer)` → `[{key, id, label, roomName, unitId, unitKey, state, tile, occupants: [{patient_id, display_name, state, types}]}]`, `bedTally(tiles)` → `{total, free, occupied}`, `unitChoices(tree, answer)`, `selectionOf(answer, selected)` → `{counts, isolated, suspected}`, `unitOf(row, index)`, `sortRows(rows, {unitOf, unitName, lang, byGroup})`, `roomCell(row, index, treeOk)` → `{key} | {why}`, `countCell(value, fresh)`, `freeBedsCell(tally, fresh, treeSource)`, `tileWords(tile, fresh)`, `alarmItems(row)`; `indexStructure` rooms and beds carry `isIsolation`.
- `IsolationBox({patientId, isolation, bed, canChart, known, nowMs, onChart, onRefresh})`, `seedOf(isolation)`; `Node({…, action})` on Yapı.
- Every `enfeksiyon.*` key the screen uses exists in `strings/enfeksiyon.js` in four languages (`enfeksiyon.strings.test.js`, `strings.test.js` and `rawKeys.test.jsx`); the reused keys exist (`eczane.ab.*`, `eczane.noRecord`, `eczane.dur.*`, `eczane.note`, `eczane.source`, `eczane.sourceOther`, `kabul.state.*`, `kabul.bedOther`, `alarms.resolvedUnacked`, `board.identityPending`); `patient.isolation.*`, `kabul.isolationMark|Unmark|On|Off`, `denetim.type.structureIsolation` and `errors.isolationFromDevice` in four languages.

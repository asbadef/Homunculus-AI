> **The binding amendments log of G2-B1a:** it supersedes the [plan](2026-10-25-g2b-kabul-taburcu.md) (and, where it says so, the spec) wherever the two differ.
> Copied into the repository at slice completion (2026-10-27, A-1…A-43) from the controller's working file `/c/tmp/homunculus-plans/g2b1a/amendments.md`; everything below this header is verbatim.

# G2-B1a — amendments after the plan (`c158c27`), binding for every implementer

Read this before your task. Where it differs from the plan text, this file wins.

## Decisions taken after the plan (2026-10-26)

- **A-1 · The user accepted X52, X57, X63, X64, X66 as a batch.** Implement them as the plan writes
  them.
- **A-2 · X51 confirmed by Lane A.** Task 5 may add the two lines at the top of `_bed_resolution` and
  the filter line + condition in `board_snapshot`. Still untouched: `_merge_alert`, `_latched_alerts`,
  `_risk`, the dict `patient_board` returns. **When A2 lands on main** it gives `patient_board` and
  `board_snapshot` a `now=None` keyword and `_news2(state, now)`: keep those signatures whenever main
  is merged in.
- **A-3 · X62 changed by Lane A: `BoardLink.chart_weight` must NOT mirror `/clinical`'s body.** After
  Lane A's A2 is on main and main is merged into this slice, Task 6 first extracts `/clinical`'s
  per-entry loop body in `api/app.py` into a helper
  `_chart_observations(hospital, engine, store, entries, *, now)` — a pure refactor, no behaviour
  change, proven by the existing `/clinical` tests staying green unchanged — and `BoardLink.chart_weight`
  calls that helper. The controller sends that hunk to Lane A before it is committed. Task 6 waits
  for A2 on main; Tasks 1–5 and the dashboard lane do not.
- **A-4 · Structure changes are audited (the user, O44 → yes).** Task 7: every structure write —
  create site/unit/room/bed, rename, close, reopen — writes one audit row through
  `admission/trail.py` (the same path the admission rows use): event types `structure.create`,
  `structure.rename`, `structure.close`, `structure.reopen`; payload = the object's kind and id, the
  unit id, the old and new name or `is_active`; the actor from the caller; no patient. Tests: one
  per event type, and a refused write writes nothing.
- **A-5 · Bed labels are unique within a unit (the user, O42 → "birimde tekil etiket").** Task 7:
  creating or renaming a bed refuses a label that already exists on another bed of the same unit
  (any room; compared trimmed and case-insensitively; closed beds count) with the stable code
  `bed_label_taken`, under a lock on the unit row so two concurrent requests cannot both pass.
  Tests: same room, other room of the same unit, other unit (allowed), case/space variants, a closed
  bed's label, the rename of a bed to its own label (allowed). Task 18 maps `bed_label_taken` in the
  Yapı tab (four languages) and Task 10's strings gain that key.

- **A-6 · Where A-5's text lives (Task 10, `586275a`).** `kabul.err.bedLabelTaken` in
  `dashboard/src/live/i18n/strings/kabul.js` (all four languages, after `nameTaken`). **Task 11** maps
  the code `bed_label_taken` → `kabul.err.bedLabelTaken` in `ADMISSION_CODE_KEYS` (`apiErrors.js`), and
  whatever list `apiErrors.test.js` reads from `admission/errors.py` must include it once Task 7 adds
  the code there (if Task 11 runs before Task 7, Task 7 adds the code to `admission/errors.py` and
  the dashboard test then agrees; report the order you found).

- **A-7 · Task 10 is executed and reviewed: `586275a` + review fixes `1451730`, `aefcb6b`.** The
  strings in the repo are authoritative; `task-10.md` and `reference.patch` hold the pre-review
  wording (az "mühərrik" not "sistem" in three texts; en/ru inpatient list title; the
  `awaitingSignature` tail "… do not wait for the signature; it is written to the admission record";
  ru age units, exitus, neutral "Приём оформлен", "Имя и фамилия", "Личные данные", "карточка";
  az "Qohumluq dərəcəsi", "Fərdi məlumatlara razılıq"; BMT unit type in tr/az). `task-14.md` lines
  187 and 231 already carry the new az texts. Any later test that pins a `kabul.*` text takes it from
  `dashboard/src/live/i18n/strings/kabul.js`, never from `task-10.md`.

- **A-8 · From the Task 1 review (`54d56f6`, APPROVED).** The catalogue now has 22 keys:
  **Task 22** also changes `docs/homunculus-rehber-TR.md:356` "21 sabit anahtar" → "22 sabit anahtar";
  **Task 19** (the dashboard sweep) also changes the prose "Twenty-one" in
  `dashboard/src/live/i18n/strings/perms.js:13` and "twenty-one rows" in
  `dashboard/src/live/screens/admin/RolesTab.test.jsx:29` to twenty-two (comments only).

- **A-9 · From the Task 11 review (`4e64337`, APPROVED).** (1) A follow-up adds a test that every
  value of `ADMISSION_CODE_KEYS`, every value of `INVALID_FIELD_KEYS` and `kabul.invalid.other`
  exists in all four dictionaries, and adds `phone`/`relative_phone` (looped in `form.py:57-59`) to
  the test's field list; (2) asserts the request bodies of the seven structure writes in
  `backendApi.test.js`; (3) makes `admissions(states)` accept a single string or `null`
  (`[].concat(states ?? [])`). **Task 7** (when it adds `bed_label_taken` to `errors.py`) also
  retires the A-6 allow-list: delete `DASHBOARD_ONLY`, the `11 + …` expression and the
  "arrives in Task 7" comment in `apiErrors.js`/`apiErrors.test.js`, restoring an exact count —
  this touches dashboard files, so it lands after the lanes merge (Task 19's sweep), not in the
  backend lane.
- **Screens using the admission API (Tasks 14–18):** an uncoded 404 detail ("Admission not found.",
  "Bed not found.", "Unit not found.") is shown by status with a localized text, never the English
  string; a timed-out `admit` (non-idempotent POST) says it may have happened and to check the
  list before repeating.

- **A-10 · From the Task 3 review (`c3ca162`, CHANGES REQUIRED → fixed in a follow-up commit on the
  backend lane).** The follow-up adds a control-character-refusing text type on every form/discharge
  text field, a +1-day slack on the birth-date rule, schema bounds matching every column, widened
  encrypted columns in `0012`, `extra="forbid"` on the request models (if the dashboard sends no
  extra field), and stricter names/phones/dates/numbers. **Task 8** must pass the hospital's LOCAL
  date as `today` (`Tenant.timezone`), not the UTC date. **Task 9** must turn a `ValueError` from
  `bed.transition_to` / `admission.transition_to` (two concurrent discharge calls) into a 409
  `invalid_transition` — lock the admission row (`FOR UPDATE`) or catch it — never a 500. **The
  dashboard** (after the lanes merge, Task 19's sweep) maps every new `field_invalid:<name>` the
  follow-up reports, in four languages.

- **A-11 · The user, 2026-10-26: readings for a discharged (`kabul` tombstone) number are DROPPED
  before the engine, with an audit row** (`event_type` `reading_dropped_discharged`, payload: the
  patient number and the code, no value) — no alert, no page. **Task 6** adds the predicate
  `BoardLink.is_discharged(hospital, patient_id)` (identity store + `_is_tombstone`) with tests;
  **Lane A** wires it into `/ingest` and `/clinical` (its boundary) after A2, with the X62 helper:
  HTTP 200 `{"patient_id": <id>, "dropped": "discharged"}`, one audit row per dropped observation,
  checked after auth and after the Patient/Encounter branch. Task 6 exports the predicate and the
  constant `READING_DROPPED_DISCHARGED = "reading_dropped_discharged"` (in `admission/boardlink.py`).
  Also in Task 6: `_merge` keeps the base `bed_id`/`unit_id` when an incoming record carries none
  (Lane A's note B). Spec §4.3 gains: a HIS key and an H-number can never collide, so a later
  non-`kabul` write cannot make a tombstone prunable (note C).
- **A-12 · Task 9 (from the Task 4 review):** the unit passed to `unitscope.reaches` is ALWAYS the
  bed's room's unit read from the database (`Bed → Room.unit_id`), never `admission.admitting_unit_id`
  (a transfer can set that from the request body).
- **A-13 · Task 7 (from the Task 18 review):** `create_room` answers a taken room name with 409
  `name_taken` (today a 500 on `uq_room_name_per_unit`); `SiteCreate`/`UnitCreate`/`RoomCreate`/
  `BedCreate` get `min_length=1` (after strip) and `max_length` equal to their columns
  (200/200/100/50).
- **A-14 · Task 19 sweep:** one shared helper in `screens/admin/refusal.js` —
  `status === 404 && !apiErrorKey(err)` → `t("errors.requestFailed", {status: 404})` — replaces the
  local copies in AdmitTab, BedsTab, DischargeDialog and StructureTab (with a `refusal.test.js`
  case); the dashboard treats `removed: true` both in the `/patients` snapshot and in pushed frames
  (check `boardStore.js`, Lane A's note D).

- **A-15 · Backend follow-up, after the Task 3 fix lands (from the Task 2 and Task 4 reviews,
  both APPROVED):** the 0012 UTC-year test runs with the test DB's timezone set to `Asia/Baku` (RESET
  in `finally`); the parity test also compares each enum's labels (`pg_enum`) to the model; a
  steady-state concurrency test (counter seeded `last=41` → H2600042, H2600043); the 0012 downgrade
  docstring says closed beds reopen and that rollback across 0012 after real admissions means the
  pg_dump, not downgrade+upgrade; `numbers.py` refuses a naive `now`; fixture numbers outside the
  generator's live range (e.g. `H9900001`); `unitscope` docstring: the bed must already be proven the
  caller's tenant's, and `None` is never turned into the key "none"; tests for a bed-only grant from
  the DB, platform support, a free-text grant, another tenant's grant, and the patient-number
  on-call window; `errors.py:25` truncated comment. **Plus, from the re-review of `123cfb7`
  (APPROVED):** `_holds_control` walks with an explicit stack (no `RecursionError` 500 on deep
  nesting; refuse nesting > 8 as `field_invalid:<field>`) and refuses non-finite floats in the JSON
  lists; a blank `institution`/`reported_by` counts as not written (`_blank`), stored as None;
  `gestational_age_weeks`/`postnatal_day` strict; one docstring line that a coded refusal stops at
  the first bad character.

- **A-16 · 2026-10-26 decisions and carry-overs.**
  - **The user: a `kabul` tombstone KEEPS the patient's identity** ("hastanın eski bilgileri
    tutulsun ve gerektiğinde bakılabilsin") — no PHI scrub at discharge. Open item for a later slice:
    a way to look up a discharged patient's past admissions and identity (who may, audited).
  - **Task 5 follow-up (review of `913e572`):** `_merge` returns None when the existing record is
    `kabul` and the incoming is not (a manual/HIS write can never flip a tombstone or strip its bed);
    `patient_ids` (memory, SQLite, Postgres) excludes `state='discharged' AND source='kabul'` so board
    loads do not slow with tombstones; SQLite adds only missing columns via `PRAGMA table_info` and
    lets other errors raise; tests: `/ingest` reading for a tombstone publishes a removal,
    `patient_board` on an unmeasured tombstone creates no engine state, SQLite upgrade from an old file,
    the `_merge` guard. **Lane A** (its hook pass with A-11): refuse incoming `meta.source="kabul"` at
    `/ingest`; the escalation cycle skips tombstoned patients (no page for a discharged patient's old
    alert).
  - **Task 3 fix (`123cfb7`) carry-overs:** `tenants.timezone` defaults to "UTC" and is unchecked →
    Task 8 uses it with a fallback to UTC on `ZoneInfoNotFoundError`; Task 23 adds a deploy data step
    setting the pilot tenant's timezone to `Asia/Baku`. Task 19 maps the 22 new `field_invalid:<name>`
    codes the fix reported (at least those today's screens send) and the 422 item types
    `extra_forbidden`/`float_type`, and adds the loop/schema-raised names to `apiErrors.test.js`'s
    list by hand.

- **A-11d (agreed with Lane A, 2026-10-26): discharge retires the patient from the alert world.**
  Lane A adds `retire_patient(engine, store, audit, hospital, patient_id, now)` in
  `api/alert_lifecycle.py`: it ends every active alert with an `alert_cleared` row (reason
  "discharged"), drops the AckStore stamps/chain/latch, and removes the engine's PatientState (a new
  forget in the pipeline). **Task 9:** the discharge-confirm path calls it once via
  `BoardLink.retire(hospital, patient_id)`, AFTER the identity store write (tombstone); the
  escalation-cycle skip stays as Lane A's guard for a crash between the two. `retire_patient` finds
  the record with `identities.get`, not `patient_ids`. **The discharge's single removal frame is
  published by Lane A's app.py code right after `retire_patient`** (alerts ended first, one place);
  B1a's `BoardLink.discharge_identity` writes the tombstone and does NOT publish a frame of its own.
  A dropped reading publishes nothing. Lane A rewrites the Task 5 `/ingest` removal test as
  `…_is_dropped_before_the_engine`; Task 9 keeps a "discharge publishes one removal" test.

- **A-17 · Dashboard merge notes (re-review of 12fix/15/16/18, 2026-10-26).** 15 `3855c7c` and 16
  `e79a988` APPROVED; 12fix and 18 got one more fix round. The four branches merge into
  `feat/g2b-kabul-fe` without textual conflict (merged tree 99 files / 2622 tests at that point).
  **The Task 14 fix conflicts with 12fix in `StructureProvider.jsx`:** keep 12fix's `reload` (ordinal
  registry, retry timer, failure count) and add `return tree` on success and `return null` in the
  `!may` branch and in the `catch` after the retry is scheduled; `NONE.reload: async () => null`;
  keep both header paragraphs; Task 14 reads `null` as "not known", never as "bed free".
  **Task 19 sweep also:** one bed wording everywhere — "label · room · unit" (DischargeTab's
  `subjectOf`, 12fix's `bedLabel`); DischargeTab awaits its reload before freeing buttons; BedsTab's
  held reason names the bed; the four local 404 helpers → one `refusal.js` helper with
  `!apiErrorKey(err)` (A-14).

- **A-18 · After 12fix `34b5539`:** `unitLabel` no longer exists in `data/structure.js`. **Task 17**
  names units with `useUnitNames(ids).nameOf` (from `StructureProvider`), never `unitLabel`
  (task-17.md lines 255/262/275/286 are stale on this); `bedLabel` still exists. Branch heads to merge
  into `feat/g2b-kabul-fe`: fe-15 `3855c7c`, fe-18 `c5c3d33`, fe-12fix `34b5539` (then the A-17
  StructureProvider resolution against Task 14's `17e5903`).

- **A-19 · The user, 2026-10-26: a server-side idempotency key on admission.** **Task 8:** `POST
  /admissions` takes `request_id` (a client-generated UUID, one per filled form), stored on the
  admission with a unique constraint `(tenant_id, request_id)` (column added in migration 0012, still
  unreleased); a repeat with the same `request_id` returns the existing admission's response (same
  body, status 200, no second patient/number), even if the first answer was lost; a repeat with the
  same id but a different body → 409 `request_conflict`. Tests: two concurrent sends with one id →
  one admission; a resend after a lost answer → the same number. **Dashboard (Task 19 sweep, after the
  lanes merge, since `extra="forbid"` refuses the field until Task 8 is in):** `admitForm.js` makes
  one `request_id` per form (new after success / «Yeni qəbul»), sends it on every send of that form.
  **Task 14 second fix now (client side):** R1 a send with a different bed or name while an
  unanswered send exists is held with `heldNoAnswer` naming that send's bed; R2 «go on» marks
  entries checked but the pre-send lookup keeps running until an admission is found; R3 a DRAFT
  found by the pre-send lookup counts as this send's only if its name matches the current form,
  otherwise show the earlier admission's number box without wiping the current form; M-1 reword the
  hold text for an unknown bed state; M-2 the recovered box says engine writes are unknown; M-4 a
  held press moves focus to the reason. Recorded at `17e5903`'s re-review.

- **A-20 · Lane A, 2026-10-26: X62 and the A-11 hooks are Lane A's slice (feat/g2a-a11, spec
  `6acd666` D8). Supersedes A-3's extraction and A-11's constant.** Task 6 does NOT touch `app.py`.
  Lane A adds a module-level `chart_observations(engine, store, audit, notifier, hospital,
  patient_id, charted, now, escalate_after) -> list[Alert]` in `api/clinical.py` (`patient_id`
  confirmed final by Lane A; its spec D8 gets amended, departure X1), `alert_lifecycle.READING_DROPPED`/`DISCHARGED`/`retire_patient`, and
  `app.state.retire_patient` = `async retire_and_publish(hospital, patient_id, frame=None, now=None)`.
  **Task 6:** `BoardLink` takes injected `chart` and `retire_patient` callables. `chart_weight` calls
  `chart(**kwargs)`. `retire(hospital, patient_id, record)` awaits `retire_patient(…,
  frame=_tombstone_board(record))` and raises `RuntimeError` if it is not wired; there is no
  fallback and it never publishes on its own. `discharge_identity` publishes nothing. There is no
  `READING_DROPPED_DISCHARGED`. `is_discharged` stays. **When Lane A's A-11 merges into
  feat/g2b-kabul-be:** wire both callables in `app.py` and apply Lane A's O1: `KABUL_SOURCE`/
  `is_tombstone` give way to `patient_identity.KABUL`/`board._is_tombstone`, and Lane A rewrites the
  Task 5 `/ingest` test as `…_is_dropped_before_the_engine`.

- **A-21 · Re-review of `019b6a1` (CHANGES REQUIRED): the admission form's memory must outlive the tab
  and the route.** `KabulScreen` renders only the current tab, so changing tabs, or leaving through
  «Paneldə bax» or the menu, unmounts `AdmitTab`. That drops `unanswered`, `held`, the form and the
  earlier-admission box. A send that lands late can then be admitted twice. **Task 14 third fix:**
  the form, `held`, `unanswered`, the checked marks and the open number/earlier box move into an
  admission-draft store owned by the signed-in session. It survives tab and route changes and is
  cleared on sign-out, on a user change and on «Yeni qəbul». The tests switch tab and route mid-send
  and come back; the session-end test asserts nothing survives. **Task 19's `request_id` lives in the
  same store**, so a resend after coming back reuses it. Minor items: the M-4 press test focuses the
  button before pressing; no hold after a definite 409 when no unchecked entry is left; the
  earlier-admission box says it is ANOTHER patient's admission (with that patient's name) above the
  number.
  **Amended after the re-review of `9531862` (APPROVED):** «Yeni qəbul» clears the form, the box,
  the hold and the id; `unanswered` STAYS (R2: the lookup runs until an admission is found).

- **A-22 · Task 17 (`2ef24d6` on feat/g2b-kabul-fe-17), carry-overs.** **Task 19 sweep:** add
  `SignOffStrip`'s local `reasonOf` to A-14's list. Unify DischargeTab's toast subject to "label ·
  room · unit". The strip already uses it, built from the admission row's `bed_label`/`room_name`/
  `unit_name`. **Open for the user / a later slice:** the board's LIST view shows no "Hekim imzası
  bekliyor" badge; only the cards show it, per spec §5.5. The texts of the new key `kabul.signing`
  join O48's native reading. **The review APPROVED `2ef24d6`.** A follow-up adds `key={id}` on the
  strip plus two tests. Also for the Task 19 sweep:
  - after a signature, focus returns to a sensible place; the same in DischargeTab and BedsTab
    (spec §5.7);
  - `useAdmissions.reload` resolves even when superseded; the post-sign re-read could free the
    button early (harmless).

  For Task 21's walk: the en badge text may overflow the 290 px card at 1440 px.

- **A-23 · Task 6 landed as `c6879d9` (boardlink.py + 14 tests, no app.py). Task 6b runs after
  Lane A's A-11 merges into feat/g2b-kabul-be.** 6b holds the three agreed `app.py` changes from
  deps.md:
  - `app.state.board_link` is built after `shadow_store`, wired with `chart=clinical.chart_observations`,
    `retire_patient=app.state.retire_patient`, `notifier` and `escalate_after`;
  - `_occupants` resolves a device's bed by the identity's own `bed_id`;
  - the 24 h retention sweep's `removed` frame carries the last bed and unit.

  6b also carries the plan's three app-level tests (the app builds its link, the sweep's removal,
  the monitor strip) and Lane A's O1 at the same merge. Task 7 does not need 6b. Tasks 8 and 9 do,
  through `board_link_of(request)`. The `_merge` carry-over (A-11 note B) is not needed: a record
  that names no location already keeps its base bed and unit, and carrying the old bed over a record
  that names a new one would pin a transferred card to its old bed.

  **The review of `c6879d9`:** spec ✅, quality CHANGES REQUIRED. The fix runs on
  `feat/g2b-kabul-be-6fix` (worktree `/c/tmp/g2b-be-6fix`) and gets merged into the backend lane.
  - **I-1:** `discharge_identity` raises on a refusal, and a double discharge returns the tombstone.
  - **I-2:** `chart_weight` raises if `chart`, `notifier` or `escalate_after` is not wired.
  - **M-1–M-5:** `_board` checks for a tombstone first and publishes nothing for an empty number;
    `retire` checks its arguments; two test pins; `kabul_record` refuses a naive `at`; docstrings.

  **Carry-over for 6b:** a test that a weight charted through the REAL `chart_observations` replays
  after a restart (rehydrate).

  **Carry-over for Task 9:** confirm-discharge does `record = await link.discharge_identity(...)`,
  then `await link.retire(hospital, number, record)`. A raise from either one reports
  `board: "failed"`, never `ok`.

- **A-24 · Re-review of `9531862` (Task 14 third fix, APPROVED); Task 19 split.**
  **Task 19a (now, dashboard only, on feat/g2b-kabul-fe):**
  - task-19.md's sweep;
  - A-8's prose;
  - A-9 (1)–(3), if not already done;
  - A-14 (one `refusal.js` helper; replace the local copies in AdmitTab, BedsTab, DischargeDialog,
    StructureTab and SignOffStrip; `removed: true` in the snapshot and in pushed frames);
  - A-17's sweep items;
  - A-22's focus items;
  - from this re-review:
    - **I-1:** each `unanswered` entry carries the `requestId` it was sent with. The form's id is
      renewed only when the found send carried the form's CURRENT id. Editing the form to another
      patient after a send with no answer gives the form a new id, and the old entry keeps its own.
    - **m-1:** the earlier-send toast says it is an earlier send's admission, not the form's.
    - **m-2:** a hold from a send's continuation is announced (toast or `Announce`), and focus moves
      on the instance that is mounted now.

  **Task 19b (after the lanes merge and Tasks 7–8):**
  - retire A-9's `DASHBOARD_ONLY` allow-list;
  - map the new `field_invalid:<name>` codes and the 422 types (A-10, A-16);
  - send `request_id` from the draft store (A-19), per entry as above.

  **Open, for the user:** a session the server ends during a send also drops `unanswered`. A
  re-login that picks another bed after a «bed not free» refusal can still admit twice, as before
  A-21. The server-side `request_id` does not cover it either, because the new form has a new id.
  A possible later guard: the server warns when an open admission already exists for the same name
  and birth date.

- **A-25 · Lane A's A-11 is ready: `feat/g2a-a11` @ `411d89c` (off main `1bc5b34`, gate 2413/655/0, Opus
  final review approved; its merge to main waits for the user's word).**

  **Task 6b order:**
  1. Task 7 lands.
  2. Merge `feat/g2b-kabul-be-6fix` (`b9be39a`) into `feat/g2b-kabul-be`, fast-forward or a merge commit.
  3. Merge `feat/g2a-a11` into `feat/g2b-kabul-be`. The backend lane already holds `1bc5b34`.
  4. Task 6b in one commit set, all of it sent to Lane A for review before the next task builds on it:
     - the `create_app` wiring of BoardLink: `chart=clinical.chart_observations`,
       `retire_patient=app.state.retire_patient`, `publish=broadcaster.publish`, `notifier`,
       `escalate_after`, `audit`, `identities`, `bedmap`;
     - A-23's three agreed `app.py` hunks;
     - **O1/O4, one tombstone predicate:** a public `is_tombstone` next to `KABUL` in
       `api/patient_identity.py` (no import cycle) replaces `alert_lifecycle.KABUL_SOURCE`/`is_tombstone`
       and `board._is_tombstone`;
     - the D6 escalation-cycle guard passes `_tombstone_board(record)` as the frame;
     - a test that a tombstone older than `DISCHARGED_TTL` survives the `_is_expired` exemption and
       its reading is still dropped;
     - the Task 5 test rewritten as `test_a_reading_for_a_discharged_number_through_ingest_is_dropped_before_the_engine`:
       200 `{"patient_id","dropped":"discharged"}`, an empty queue, one `reading_dropped_discharged`
       row, `/patients == []`;
     - a weight charted through the REAL `chart_observations` replays after a restart (A-23).

  **Task 9 (refines A-23's carry-over):**
  - `discharge_identity` raises → `board: "failed"`.
  - `retire` raises `ValueError` or `RuntimeError("…not wired")` before the door → `board: "failed"`.
  - An exception from INSIDE the door (`retire_and_publish`; the alerts were already ended in memory,
    the removal frame was still published in its `finally`, an audit write failed) is NOT a failed
    discharge: report the board as done, mark the alert-retire part `incomplete`, and log the error
    with the number. Tests for all three.

  **Lane A's conditions for 6b (agreed 2026-10-26):**
  - (1) `is_tombstone(record)` becomes public in `patient_identity.py`, next to `KABUL`.
    `alert_lifecycle.py` imports it from there. `KABUL_SOURCE` goes. `DISCHARGED`, `READING_DROPPED`,
    `retire_state` and `retire_patient` stay in `alert_lifecycle` unchanged.
  - (2) These keep their semantics byte for byte: `retire_and_publish`, the door drops, the identity
    refusals, the `_ensure` sweep and the replay branch. The ONLY change there is the D6 guard's
    `frame=_tombstone_board(record)`, reusing the record the guard already read (one
    `identities.get` per alerting patient).
  - (3) In `test_api_discharge.py`, only tighten the `/patients` assertions to "the number is
    absent" where the board now omits tombstones.
  - (4) The `DISCHARGED_TTL` merge test drives the real cycle (`app.state.escalation_cycle` at
    now + 25 h), then posts a reading.
  - (5) `chart_observations` stays where it is. The wiring passes `app.state.retire_patient`
    (`retire_and_publish`) and `broadcaster.publish` by reference, never re-implementations.

  **6b landed: merges `a4b78d1` (BoardLink fixes) and `8e234e2` (A-11, no conflict), then 6b itself
  `80daf2a`. Lane A APPROVED it.** Lane A's note 5 was wrong: `_own_bed` blanks bed and unit for a
  record that is not admitted, so a unit-scoped `/clinical` on a tombstone gave a 404 plus a false
  `scope_denied` row. **Lane A's decision:** `_require_patient` scopes a tombstone by
  `tombstone_board(record)["identity"]`. A caller from the last unit gets `dropped` and no
  `scope_denied` row; a caller from another unit still gets 404 plus `scope_denied`. It is done
  as a 6b follow-up, with the rename `_tombstone_board` → `tombstone_board` (Lane A nit a). Lane A
  nit b: the kabul branch of the 24 h sweep's frame cannot be reached today, because a kabul
  tombstone never expires. It stays as a guard.
  **The follow-up is `0de9749` (rename) + `c746500` (note 5), both APPROVED by Lane A.** Lane A's call:
  `POST /scores/sofa/{id}` on a tombstone should answer `dropped` without a `score` row. Lane A takes
  this in its A4 slice, so there is nothing to do on our side. `POST /view` writing a `view` row is
  correct. Lane A's A3 (`feat/g2a-a3`) touches `board.py:_meds`, adding `pressors_at`/`charted`, and
  `boardStore.chart`; none of these are B1a files. **The deploy order of A2/A-11/A3 and B1a is
  decided together, one VM deploy at a time.**

- **A-26 · Review of `1a6f5e5` (Task 7): spec ✅, quality CHANGES REQUIRED. Fixed on
  `feat/g2b-kabul-be-7fix` (worktree `/c/tmp/g2b-be-7fix`), merged into the backend lane after 6b.**
  - **I-1:** the unit lock `FOR UPDATE` blocks the `FOR KEY SHARE` that an FK insert pointing at the
    unit takes (`admissions.admitting_unit_id`, handovers, nurse-bed). With the admission's bed lock,
    that deadlocks into a 500. Use `with_for_update(key_share=True)` (`FOR NO KEY UPDATE`) on the unit
    lock and in `patch_unit`, and on the bed locks unless the bed row's key changes. **Tasks 8 and 9
    use the same lock strength** for every unit/bed lock.
  - **Rule for Tasks 7–9 (the controller's call, consistent with A-25):** an audit write that fails
    AFTER the commit never turns a committed change into a 500. The route answers its normal
    success and logs at ERROR with the event type, the ids and the actor, and no PHI. Each route
    gets a test that a failing audit store still answers success and logs.
  - **Minor:**
    - PATCH schemas strip before checking, with no `min_length`, so `""` and `"  "` both give
      the coded `field_invalid:<name>`;
    - pin the `everything` branch (an admin with a unit grant sees both units);
    - the bed-grant test grants bed "2" of Otaq 1, so a sibling leak would show;
    - tests for "²" in a name (no 500) and for a room-number change inside `structure.rename`.
  **The fix is `06e4e37`, APPROVED on re-review.** One more commit then adds the M-1 comments and
  the M-2 `trail._ids` allow-list. **For Tasks 8 and 9 (binding):**
  - every unit or bed lock is `with_for_update(key_share=True)`. task-08.md:278 and :394 still show
    a bare `.with_for_update()`, so do NOT copy them;
  - lock the bed BEFORE writing any row that points at it. This covers admission, transfer and
    discharge; a relabel upgrades the lock, so the order matters;
  - audit rows go through `trail.record` after the commit; it never raises, per the A-26 rule;
  - `_lock_unit` and `_lock_bed` in `tenant/router.py` may be reused.

- **A-27 · Lane A and the user, 2026-10-26: Aşama B (the Infinity values become the linked patient's
  engine input; alarms stay off) starts after B1a is on main AND the VM has E-1 (the ward structure
  in Yapı) and E-2 (`device-beds.icu2.json` v2 with tenant bed UUIDs, each row approved by the user).**
  Device→bed table v1 has 13 rows (BED01, BED05–15, BED25), all with `bed_id`/`unit_id` null.
  **Task 23:**
  - E-1 builds EVERY bed the ward actually has; the user's bed count is pending, and Lane A relays it.
  - E-2 maps the 13 monitored beds.
  - E-2's read-only query prints, per bed: the bed label, bed UUID, unit UUID, unit name and room
    name, so the v2 rows can be written without a second query.
  - The interface Aşama B relies on: a `kabul` record's `bed_id` is the tenant bed UUID, read
    through `identities.get` and `_occupants`.

- **A-28 · Lane A, 2026-10-26: A3 (vasopressor/fluid charting) is pushed at `feat/g2a-a3` @ `ec82ef0`
  (13 commits on main `411d89c`). Its merge to main waits for the user's word.**
  - **An expected red until A3 is on main:** main `411d89c`'s DASHBOARD suite fails one test,
    `apiErrors.test.js`. A-11's `detail` "identity source 'kabul' is reserved for the admission"
    has no translation yet; A3 adds `kabulSourceReserved` in `strings/errors.js`.
  - **Our lanes merge:** the backend lane already holds `411d89c`, so the merged slice shows that
    same single failure.
    - Once A3 is on main, merge main into `feat/g2b-kabul` before Task 20's gates. A3 touches only
      `board.py:_meds` (`pressors_at`, `charted`), `boardStore.chart(…, recordedAt)`,
      `screens/patient/meds/*`, `patient.js` and `errors.js`, so Lane A expects no conflict.
    - If A3 is not on main by Task 20, record the failure as Lane A's and do not "fix" it in B1a.
  **Update:** A3 is on main, fast-forwarded to `ec82ef0` and pushed, followed by one docs commit
  (K1). The main dashboard suite is green again. Merge main (at `ec82ef0` or later) into the slice
  before Task 20; Lane A expects no conflict.
  **The user's decision for E-1:** Yapı gets ALL the reanimasyon beds; the count is still open. Ask
  for it in E-1's block, or build the ward from its own list. v2 maps the 13 monitored beds.

- **A-29 · Task 8 landed: merge `31954f1` (7fix) + `bfffaaf` (0012 gains `request_id`, `request_digest`
  and `engine_writes`, plus `crypto.phi_digest`) + `28261ff` (routes). It is under review.**
  **For Task 19b:**
  - map the new code `request_conflict` in four languages; `apiErrors.test.js` fails until then;
  - consider showing `request_id` on the `GET /admissions` rows, so the pre-send lookup can match a
    send by id rather than by name.
  **For Task 23:** set the pilot tenant's timezone to `Asia/Baku`. The API image resolves it; the
  Windows test venv lacks `tzdata`, so the real-zone test skips there.
  **The replay wait** assumes one uvicorn worker, which holds today.
  **The review APPROVED Task 8**: spec ✅, no Critical or Important findings. A follow-up commit fixes:
  - the wait-timeout log, and the read transaction closed before waiting;
  - real tests for the wait;
  - no BoardLink → asked parts `failed` + an ERROR log;
  - the audit row written before anything that can fail after the commit;
  - `GET /admissions` selects only what it needs, filters by scope in SQL, defaults to open states
    and caps the result;
  - a digest docstring line;
  - the 409 `request_conflict` detail carries the earlier admission's `patient_number` (Task 19b
    shows it).
  **The controller's call on `_unrecorded`:** a replay that finds no recorded engine report RETRIES
  the idempotent parts (`put_identity`, `apply_profile`). It does not retry the weight, which
  reports `failed` so the nurse checks it.
  **The re-review of `5107da2`: CHANGES REQUIRED, one Important.** A resend's retry
  `put_identity` could race a Task 9 discharge and bring the card back as `admitted` over the
  tombstone, for good.
  - **Fix:** `BoardLink.put_identity` refuses a discharged number (`_refuse_discharged`).
  - **Tests:** the gate test (lost answer → discharged → resend → no card, `failed`).
  - **Minor:**
    - no BoardLink → `failed` in Task 9's paths too (task-09.md ~716 says `skipped`; that is wrong);
    - the list cap logs a warning and sets `X-Result-Truncated`;
    - a DB matrix test of `reach_clause` against `reaches`.
  - **Who does it:** the Task 9 implementer, as its own commit.

- **A-30 · Task 9 landed on the backend lane: `28f152f` (the Task 8 re-review fixes) and `def4caa`
  (sign-off and discharge). Under review.** The lanes merge runs in parallel into `feat/g2b-kabul`:
  fast-forward to the backend lane, then the dashboard lane `--no-ff`, then main `68b15ad`.
  **For Task 19b:**
  - show the confirm answer's new `alerts` field (`ok`, `incomplete`, `failed`);
  - read `X-Result-Truncated` on the admissions list. Same-origin on the VM through nginx; CORS does
    not expose it, which matters only cross-origin. If needed, ask Lane A to expose it in `app.py`;
  - the discharge dialog's default time must not fall before the admission time: default to
    max(now, admitted_at) or keep the seconds. Today a discharge within the admission's minute is
    refused with `field_invalid:discharge_at`;
  - map `request_conflict` (showing its `patient_number`), `bed_label_taken` (retire
    `DASHBOARD_ONLY`), and every new `field_invalid:<name>`.
  **Open for the final review:**
  - the transfer routes are not locked bed → admission (A-26 names transfer);
  - the A-29 guard lives in memory and assumes a single worker.

- **A-31 · The VM is on main `68b15ad` (A2 + A-11 + A3), switched at about 17:50Z on 2026-10-26.**
  The images are api `f63c2d03` and web `1f5c72b1`. There was no migration (alembic stays at `0011`),
  hub R4 was not touched, and the rollback tags `:pre-a2a3` point at the A1 images.
  **For Task 23:**
  - the B1a bundle is `68b15ad..<the B1a merge on main>`, and the pre-check expects VM HEAD `68b15ad`;
  - leave `~/a2a3`, which holds Lane A's "before" records;
  - B1a's deploy is next: one deploy at a time, after B1a is on main and the user says so;
  - migration 0012 is B1a's first migration on the VM (0011 → 0012).

- **A-32 · The review of Task 9 (`28f152f` + `def4caa`): spec ✅, quality CHANGES REQUIRED.**
  - **The user's decision (2026-10-26): the discharge CONFIRM also checks for an open critical alarm**
    (the "Onayda da kontrol et" option). Under the locks it re-runs `open_critical` and refuses
    with 409 `critical_alarm_open`. This supersedes spec D7, which held only at the start.
    Exitus is not exempt: someone acknowledges the monitor's last critical alarms first.
  - **I-2:** a confirm on an already-DISCHARGED admission re-runs the off-the-board step
    (`discharge_identity` + `retire`) as a retry. `beds.release` heals a non-tombstoned last occupant,
    or refuses with 409 `board_not_cleared`.
  - **M-1:** the transfer routes lock bed → admission with key-share; the target bed is locked before
    its AVAILABLE check.
  - **M-2:** the `RetireIncomplete` docstring is corrected.
  - **Task 19b:**
    - map `board_not_cleared`;
    - show `critical_alarm_open` in the confirm step of the discharge dialog;
    - offer a retry of the confirm when `board: failed`.
  - **Docs (Task 22):** the discharge hold applies at the start AND at the confirm.

- **A-33 · Task 19b landed on `feat/g2b-kabul`, under review.** The commits:
  - `2e12f15`: codes;
  - `3ecf8ef`: `request_id`;
  - `3fb52d7`: discharge confirm and retry;
  - `9757833`: the truncation flag;
  - `b44881d`: the `boardNotCleared` texts.

  The suite is 103 files / 2805 tests.

  **After the backend Task 9 fix merges,** apply the scratchpad patch
  `board-not-cleared-after-backend-merge.patch`. It holds the map line, the count 13 → 14 and a
  BedsTab test.

  **The controller's calls:**
  - (1) The Taburcu tab has no unit filter, so the note's text says "narrow by unit, or tell the
    administrator". A single ICU will not reach 500 open admissions. Wiring the top bar's unit chip
    into the tab is LATER, as a B3a candidate.
  - (2) The board-failed note lives in the tab's state and is lost on a tab change. This is
    accepted, because releasing the bed re-runs the off-the-board step on the server (A-32 I-2).
  - (3) The generic 422 texts sit under `kabul.invalid.*`; this is accepted.

  **O48 (native reading):** 26 new keys, all languages written by the agent, the tr source included.

- **A-34 · The 19b review: CHANGES REQUIRED (3 Important).**
  - **I-1:** the discharge-at-admission-time default must send the server's exact
    `admission_datetime` string. The server keeps microseconds, and JavaScript truncates them to
    milliseconds, so the sent time comes out earlier and is refused.
  - **I-2:** the confirm modal re-checks the hold live.
  - **I-3 (the controller's call):** `request_conflict` keeps the unanswered entries, so the R2
    lookup keeps running. Removing them allowed a duplicate admission through «Yeni qəbul».
  - **Minor:** the conflict toast's subject must not name the current bed.
  - **For the backend fix:** the already-DISCHARGED retry branch runs BEFORE the confirm-time
    critical check. Otherwise a `board: failed` card with an alert cannot be retried.

- **A-35 · The Task 9 fix is in on the backend lane: `c355189` (I-1, M-2), `ce357aa` (I-2: `BoardLink.take_off`,
  re-confirm retry audited as `admission.discharge_board_retry`, release → `board_not_cleared` with
  `patient_number`), `ff15167` (M-1 transfer locks), `5b562a6` (the retry branch runs before the
  critical check).** Next: merge into the slice, wire `board_not_cleared`, run Task 20's gates.
  **Open for the final whole-slice review:**
  - (a) The transfer routes have NO unit-scope check, and `target_unit_id` from the body is not
    checked against the target bed's real unit. These existed before B1a; there is no transfer UI.
    The final review decides whether to fix them now or record them for a transfer slice.
  - (b) A one-commit window between the confirm's critical check and the board step. The retry and
    the release end a standing card's alerts unseen. This follows the rule that the check belongs
    to the real confirm only.
  - (c) The retry can publish a second removal frame. That is harmless, because applying it twice is
    the same as once.

- **A-36 · Lane A's shell hotfix `fix/g2-main-containing-block` @ `377033f` (off main `68b15ad`),
  waiting for the user's merge and a web-only VM deploy.**
  - **The fault:** `sr-only` spans (`position: absolute`) took the AppShell scroller as their containing
    block. The scroller gained about 890 px of overflow, which drew a black band under the patient
    screen.
  - **The fix:** `relative` on `<main>` in `src/live/shell/Shell.jsx`.
  - **For B1a:**
    - once it is on main, merge main into `feat/g2b-kabul` before Task 21's walk and Task 23's
      bundle. Expect a one-line conflict only if B1a touched that `<main>` line;
    - the final review checks that every new B1a `sr-only` or absolute element sits inside a
      positioned ancestor. Examples: `Announce`, hidden labels in badges, the strip, and the
      modals, which are portals;
    - Task 21's walk scrolls Kabul, Taburcu, Yataklar and Yapı to the end and checks there is no
      band and no shell scroll.

- **A-37 · Final whole-slice reviews (2026-10-27).** The backend came back CHANGES REQUIRED (2 Critical,
  both in the pre-existing transfer routes). The dashboard came back READY TO MERGE (1 Important,
  a user decision). **The user's decisions:**
  1. **The transfer API is CLOSED for now ("Şimdilik kapat").**
     - `POST …/transfer/initiate` and `…/transfer/confirm` refuse with 409 `transfer_unavailable`.
       Nothing is written, and the refusal is checked after auth and tenant checks.
     - The transfer route tests are adjusted: `test_discharge_api.py:463, 489` and
       `test_tenant_isolation.py:452`. `test_route_permissions.py` keeps the permission gate.
     - **A transfer slice reopens them with:**
       - `_reach_admission` on the source bed and `require_reach` on the target bed's REAL unit;
       - `target_unit_id` taken from the target bed, or refused when it differs;
       - the confirm bound to the bed named at initiate;
       - the card moved with `put_identity`;
       - `_last_card_off` covering TRANSFERRED as well;
       - a transfer UI.
     - Why: (C-1) a transfer left the card on the source bed, so the bed could be released and
       admitted into again, putting two cards on one bed and breaking the monitor link. (C-2) A
       doctor of one unit could move another unit's patient into their own unit and discharge
       them. No client calls these routes.
  2. **The server refuses a second open admission for the same person ("Sunucu kesin reddetsin").**
     - The key is the same name and birth date in the tenant while another admission is open
       (DRAFT, ACTIVE or PENDING_*). The answer is 409 `duplicate_open_admission`, carrying the
       existing `patient_number` only when the caller's units hold its bed; the refusal itself
       stands either way. The earlier admission must be discharged first.
     - **How:**
       - a keyed `identity_digest` (`crypto.phi_digest`) over a normalised (full name, birth date);
       - name normalisation: NFKD, strip combining marks, casefold, map ı→i, collapse whitespace,
         strip; that covers Turkish and Azerbaijani İ/ı/ə and accents;
       - the date is ISO;
       - the digest is stored on the admission (migration 0012, still unreleased), with a PARTIAL
         UNIQUE index on (tenant_id, identity_digest) WHERE the state is open;
       - no digest when the birth date is unknown;
       - legacy rows stay NULL.
     - **Order:** the A-19 replay lookup runs first, then the duplicate refusal, then `bed_closed`
       and the rest. Two concurrent sends for one person to two beds admit ONE; the unique index
       is the guard.
     - **The dashboard maps** `duplicate_open_admission` in four languages, naming the number
       when present. The form is held and not sent again.
     - This closes A-24's open item: re-login, page reload and a second tab.
  - **Backend minors fixed in the same round:**
    - `transition_bed` (admin, raw) refuses HOUSEKEEPING→AVAILABLE while the last occupant's card
      stands (`board_not_cleared`), and refuses freeing a bed whose admission is still open; the
      docstring is corrected;
    - `_last_card_off` checks EVERY non-tombstoned DISCHARGED admission on the bed, not only the
      latest by `updated_at`;
    - next to `Dockerfile.api`'s CMD: `--workers` must stay 1 (A-29 and `auth/limits.py`);
    - stale comments (`boardlink.py:19-20`, `app.py` `_occupants` docstring; app.py is Lane A's,
      so a comment-only hunk for its review).
  - **Dashboard minors fixed in the same round:**
    - M-1: `findLanded` reads DRAFT and ACTIVE;
    - M-2: NumberBox focuses only when focus is on body or the submit;
    - M-3: the missing-bed error has an id, referenced by the bed button;
    - M-4: the DischargeTab buttons put the bed in `aria-label`;
    - M-6: stale comments.
    - M-5 (az "Alarm" → "siqnal") goes to O48.
  - **Recorded for later slices or the user:**
    - the read routes `GET /admissions/{id}`, `/patient`, `/care-team` and `care-team/claim` are
      tenant-only, not unit-scoped. This existed before B1a; it goes to a scope slice;
    - neither engine sets SQLAlchemy `hide_parameters`, so a 500 logs plaintext note text. This
      existed before; propose it to Lane A;
    - A-11's drops are audit-only. A one-digit typo on a monitor's patient number (the previous,
      discharged H-number) silently drops a live patient's vitals. Surface
      `reading_dropped_discharged` on the monitor strip; this goes to Lane A for Aşama B.
  - **A-36:** B1a's `sr-only`/Announce elements in BedsTab, StructureTab and AdmitTab (390 px) would
    draw the band without Lane A's `377033f`. Merge that hotfix before the walk; it dry-merges
    cleanly.

- **A-38 · main is `377033f` (Lane A's shell hotfix, fast-forwarded from `68b15ad` and pushed).** A web-only VM
  deploy follows when the user pastes the blocks (rollback tag `:pre-fix1`), and Lane A says when
  the VM's HEAD moves to `377033f`. **For B1a:**
  - merge main `377033f` into `feat/g2b-kabul` after the dashboard minors' Part 1 lands, and
    before the walk;
  - Task 23's pre-check expects the VM HEAD Lane A reports at that time: `377033f` once its web
    deploy is done, otherwise `68b15ad`.
  **Update 2026-10-27 06:11Z:** the VM is on main `377033f34090f8d72ecd3976968e0cb8ffaeb2fa`.
  - The web-only build is `index-BdeicX_l.js` and health answers 200.
  - The api container was not touched; it is still the 26.10 17:46Z start.
  - The rollback tag is `homunculus-rollback/web:pre-fix1`.
  - **Task 23's pre-check expects HEAD `377033f`, and the bundle is `377033f..<B1a merge on main>`.**
  - The next VM slot is B1a's, on the user's word.

- **A-39 · The A-37 backend fixes are merged into the slice as `b3b7506`.** The commits are
  `090ca48` (transfer closed), `a659e7d` (one open admission per person: `identity_digest` and the
  partial unique index `uq_admissions_open_identity` in 0012), `b112d98`, `34aa97d`, `fd4d799` and
  `59b3574` (the app.py comment, sent to Lane A). Main `377033f` is merged as `a2f1834`.
  - **Any local stack already at 0012** (e.g. a walk stack) must go down to 0011 and back up,
    because 0012 changed again.
  - **Known cost, for later:** `_last_card_off` reads the identity once per DISCHARGED admission the
    bed ever held, so it grows over the years. A later slice can bound it with a `board_cleared`
    flag set when `take_off` succeeds.
  - **Name normalisation:** `ə` does not decompose, so "Məmmədov" and "Memmedov" stay two different
    names. That is acceptable: Azerbaijani keyboards type ə.
  - **Next:** dashboard Part 2 maps the two codes; then re-run the gates (a Task 20 re-run, at least
    the no-DB suite, the B1a DB chunks and the dashboard), then Task 21.

- **A-40 · main is `d7c0d2b`, fast-forwarded from `377033f` with two docs-only commits (Aşama B's spec and
  plan). There is no code and no migration.** The VM still runs `377033f`. Before B1a goes to main,
  merge main (`d7c0d2b` or later) into `feat/g2b-kabul`; it is docs only, so no conflict. Task 23's
  pre-check still expects VM HEAD `377033f`.
  **Migration numbers:** 0012 is B1a's; 0013 is Lane A's Aşama B (`monitor_samples`). Lane B's
  device→bed editor takes the next free number at plan time, after checking with Lane A.

- **A-41 · Task 21 walk (2026-10-27, stack `-p g2b` on 18090, at `08837fd`): every step and every extra item
  passed. No Blockers.** The walk confirmed, live:
  - the duplicate open admission is refused;
  - the confirm holds on a critical alarm (row and modal, live), and the server refuses on its own;
  - the form keeps its memory across tabs and routes;
  - there is no black band at 1440 or 390;
  - the monitor strip links a kabul card through its own `bed_id`;
  - a restart keeps tombstones and replays the weight.

  Synthetic patients: H2600001 to H2600004. Screenshots are in `walk/`.

  **Findings fixed in a walk-fix round (running):**
  - I-1: a grant key shows as a UUID on a nurse's board (the server-written scope notice);
  - I-2: the scope editor cannot grant an empty unit by name; its free-text hint is stale;
  - M-1: Yapı scrolls sideways at 390 px;
  - M-2: Yapı's name inputs have no visible labels;
  - M-3: the bed picker's accessible names;
  - M-4: tr "KVKK onamı" (Turkey's law) for a Baku hospital;
  - M-5: a closed bed shows both Bağlıdır and Boş;
  - M-6: duplicate error toasts.

  **Plan deviations for Task 22's record:**
  - D-1: bed labels are unique per unit;
  - D-2: septic shock needs a charted crystalloid bolus;
  - D-3: the unit chip appears only with two or more units;
  - D-4: the strip shows values only for packets under 15 s old;
  - D-5: the nurse with one unit has no chip.

  **Pre-existing, outside B1a (for later slices or Lane A):**
  - the az string "Panelde";
  - Turkish role names in the az admin screens;
  - alarm acknowledge labels show raw engine kinds ("septic_shock alarmı: gördüm");
  - the patient screen names the raw permission "clinical.chart";
  - en "1 beds";
  - a stale unassigned shadow device stays listed.

  **The stack is left up for the user.** Tear-down only on the controller's word:
  `docker compose -p g2b … down -v`.

- **A-42 · main is `b985810`: one test-only commit, pushed.** It fixes a date bomb in
  `tests/test_api_discharge.py::TestTheDischargeRetiresThePatient::test_the_escalation_cycle_retires_an_alerting_tombstone_instead_of_paging`.
  The test stamped its tombstone at the fixed 26.10 09:00Z, which crossed `DISCHARGED_TTL` at 27.10
  08:30Z. The fix stamps it at the wall clock.
  - **For B1a:** merge main `b985810` into `feat/g2b-kabul` after the walk-fix round. Our tree also
    edited `test_api_discharge.py` (the A-25 condition 3 `/patients` assertions), so expect a small
    merge in that file; keep both changes.
  - **Until that merge,** this test's failure in a gate re-run is expected and is Lane A's.
  - **Check B1a's own tests for the same pattern:** a fixed `WHEN` plus a TTL or the wall clock.

- **A-43 · The walk-fix round (`8fd7a89`..`926848a`) is APPROVED. The re-review found no date bombs:** fixed
  clocks are passed through, kabul tombstones never expire, and the year in the number comes from
  `created_at`. Nothing else reads the removed `scope.unmatched_grants`; mobile does not.
  **A small follow-up, after the gate re-run:**
  - `ScopeEditor.sameGrant` compares ids case-insensitively, and `offered.beds` de-duplicates by
    `normId`, so the same place cannot be granted twice;
  - `ScopeEditor.jsx:31-35`'s comment no longer claims bed-mapping values are UUIDs (D9 says
    "later"; `bed-mapping.json` is still free text);
  - `ScopeNote` shows `kabul.namesPending` when the names are placeholders;
  - a test for "Naməlum şöbə N".
  **For Task 23:**
  - B-1 also reports whether the VM's `bed-mapping.json` uses free-text keys, by count only.
  - An EMPTY unit with a legacy key cannot be granted from the editor; only a card carrying it
    can. Record this for the scope slice.

## Housekeeping

- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Commit only with a pathspec (`git commit -m … -- <paths>`); another lane may commit in a sibling
  worktree of the same repository.
- Test Postgres: `TEST_DATABASE_URL=postgresql+asyncpg://homunculus:homunculus@localhost:56432/homunculus_test`
  (container `homunculus-test-pg-56`), shared with Lane A — conftest serialises runs with an
  advisory lock; a long wait for the lock is Lane A's run, not a hang.

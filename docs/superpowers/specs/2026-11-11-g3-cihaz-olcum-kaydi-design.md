# G3-05 · Device readings record («Cihaz ölçüm kaydı») — design

**Date:** 2026-11-11 · **Branch:** `feat/g3-cihaz-olcum-kaydi` (from main `331df704`) · **Migration:** `0021`
(after Kalite's `0020`; `down_revision` is fixed by whoever merges second, `alembic heads` stays one)
**Status:** the owner's five decisions are taken (2026-11-11, §2 D1–D5) and the four design points put to
the owner are confirmed the same day (§10 Q1–Q4). **The owner approved the design as a whole («Evet, plana
geç», 2026-11-11).** Implementation plan next.

## 1. Why

On the wards, vitals are not typed by hand. Each floor has two or three Welch Allyn Connex Spot devices; a
nurse takes a round about every hour, types or scans the patient's protocol number in the device's ID field,
and the device sends the set (owner, 2026-11-11). The owner wants each of those readings attached directly to
the patient's record for that protocol — the admission.

What main does today (read at `b6c0dcd8`/`331df704`):

- A reading reaches `/ingest` under the typed number and is kept as one `ingest` audit row plus in-memory
  engine state. It shows on the admission's card only because the number's text equals the card key
  (`admission/boardkey.py`: `protocol_no or patient_number`). **No stored reading carries an admission id**,
  and no vitals table exists (migrations 0001–0019).
- A number that matches nothing makes a nameless «kimlik kaydı yok» card that scoped users cannot see
  (`scope/rules.py`). Nothing lists such readings and nothing can move one to the right patient.
- A reading for a discharged number is dropped and **its value is not kept** (`reading_dropped_discharged`,
  payload `{patient_id, code}`; G2-A11 D3).
- A device value cannot be withdrawn (G3-01 D11): the retract route takes `chart` rows only (`api/app.py`,
  `retract_entry`).
- The «vital zamanı» task counts hand entries only (G3-02 D2; `api/tasks.py` `_stamps_by_patient`).

This slice gives device readings a durable, per-admission record, a place for the ones that match nobody, a
way to correct a wrong one, and lets them satisfy the vital task.

## 2. Decisions

| # | Decision | Why |
|---|---|---|
| D1 | **The number on the device is the Homunculus 12-digit protocol** (owner). Comed's protocol number is not looked up. | It is what B1d's label, barcode and device query already carry. Comed's number is stored encrypted and cannot be searched (`Patient.his_patient_reference`). |
| D2 | **Durable record and screen** (owner). Every device reading is stored linked to its admission and shown on the patient screen with its source, «cihaz» or «elle». | "HBYS için daha mantıklı": a stay's measurements belong to the stay. |
| D3 | **A wrong device value can be corrected by the nurses** (owner: «yanlış yansıma olduğunda bunu düzeltebilsinler»). **Overrides G3-01 D11.** | The device is the normal source on the wards, so its errors must be correctable where the hand entry's are. |
| D4 | **An unmatched reading goes to an «Eşleşmeyen ölçümler» list with its value** (owner). An authorised user links it to the right admission or rejects it. **Overrides G2-A11 D3 at `/ingest`** (value now kept; still no alert, no page, no card) **and B1d D4** (no nameless card in the hospital). | No measured value is lost to a typo or to timing. |
| D5 | **A device reading counts for the vital task** (owner). **Overrides G3-02 D2.** | Otherwise a nurse would retype the device's values to clear the task. |
| D6 | **New table `vital_readings`** (§3), written by both doors: every `/ingest` observation (`origin='device'`) and the bedside set of `POST /clinical/{id}` (`origin='manual'`: `RETRACTABLE_CODES` minus the fluid volumes). The patient screen's record box reads this table only. | One queryable record per stay. The audit table has no admission link. |
| D7 | **The audit trail stays the source of truth; the table is its projection.** The engine, the restart replay and "who did what" keep reading audit. Every table row is derivable from audit rows. Write order is always the audit row, then the table row. A failed table write is logged and does not fail the request — except on the unmatched path, which answers 500 so the bridge retries, because there the table is the only place the nurse will see the reading. An idempotent `reconcile` (audit → table, `ON CONFLICT DO NOTHING` on `(tenant, audit_id)`) runs at start and hourly over the last 48 h. | `PostgresAuditLog.append` owns its engine, transaction and chain retry; one shared transaction would change the audit protocol across three backends. A 500 after the engine took a value would make the bridge resend and count it twice. |
| D8 | **The admission is resolved and stamped at arrival**, from the identity record `/ingest` already reads: a `kabul` record in state admitted → matched, `admission_id` set by the rule `tasks_postgres.admitted_at` uses (open states, DRAFT included; `protocol_no = key OR (protocol_no IS NULL AND patient_number = key)`); a `kabul` tombstone → unmatched, reason `discharged`; a record of another source (a HIS-fed patient) → today's path, `admission_id` NULL; no record → D9. The SQL fragment moves to one shared module. `boardkey.py` is untouched. | The `kabul` card exists from POST /admissions (DRAFT), so a draft is a valid target. Legacy H-number keys resolve by the second arm. After a transfer the new readings get the new admission row; `patient_key` spans the stay. |
| D9 | **Unknown number: a policy switch.** `create_app(unknown_readings=…)` takes `"card"` or `"unmatched"`, default `card` (today's behaviour, so the test suite, `replay.py` and the seed scripts keep working). `prodserver` sets `unmatched` on Postgres; env `READINGS_UNKNOWN_KEY=card` turns it back for a replay. In `unmatched` any number with no identity record is listed: no engine entry, no card, answer `{"patient_id", "dropped": "unmatched"}`, always 200. | Many test files (the design read counted 33) and the scripts `replay.py` and `dev_seed_ward.py` ingest without an identity. A "12 digits only" rule would miss the 11- and 13-digit typos, which are exactly the cases the list is for. |
| D10 | **The list and its two actions** (§4): `GET /readings/unmatched`, `POST /readings/unmatched/assign`, `POST /readings/unmatched/reject`. Permission `clinical.chart`, a person only (a device token is refused). Readings are grouped into sets (one number, one device, one time). **Confirmed by the owner (§10 Q1).** | A `clinical.chart` holder can already type the same values back-dated for any patient in scope, so linking is the weaker act. No new permission, no permission migration. |
| D11 | **Who sees what in the list.** A set under an unknown number has no patient, so every `clinical.chart` holder sees it (number as typed, values, device, times — no name exists). A set under a discharged number is shown only to users whose scope covered that patient's last unit. The assign target must pass `_require_patient` and must not be discharged, and the screen repeats the bedside page's identity question before linking. | Hiding unknown sets from scoped users, as nameless cards are hidden today, would leave the list unworked. |
| D12 | **Linking puts the reading into the real engine at its own time.** `/ingest`'s tail becomes one function `_apply_reading(hospital, obs, record, wall_now)`; assign calls it per reading with the original measurement time and the device as source, which writes a normal `ingest` row carrying `"reading": id`, then one `reading_assigned` row per set. The row is claimed first (`unmatched → assigned`, conditional update), a failure releases the claim, and `reconcile` releases orphaned claims. A reading older than 24 h cannot be linked, only rejected. **Confirmed by the owner (§10 Q2).** | Not through the hand door: that would print «elle» and apply the hand form's bounds. Alert behaviour equals a back-dated hand entry: judged at its own time, and NEWS2 inputs go stale after 1–2 h. 24 h is G3-01 D7's back-dating bound. Rows are never deleted. |
| D13 | **Correction reuses «hatalı giriş».** `POST /clinical/{id}/entries/{entry}/retract` also accepts an `ingest` row whose code is in `RETRACTABLE_CODES`: same permission, person only, reason 10–200 characters, same rebuild (every score as if the value had never arrived). The audit event stays `chart_retract`, its payload gains `"origin": "device"` and the device. The corrected value is a normal hand entry at the reading's own time, offered in the same dialog (within 24 h). The original stays in the record, struck through, with reason, name and time. **Confirmed by the owner (§10 Q3).** | One withdrawal event means every existing reader honours it: `rehydrate`, `rebuild_patient`, trends, fluids, pharmacy, tasks. The trail keeps both values. |
| D14 | **A re-sent reading is recognised.** Before the engine: `readings.seen(tenant, received_key, code, observed_at, source, value)`; a hit answers `{"duplicate": true}` with no engine entry and no audit row; a store error fails open (the reading is ingested). A unique index on the same columns for device rows backs it. | The Connex re-sends buffered readings and the uplink is at-least-once. Without this a re-send would bring back a withdrawn value or re-create a rejected or linked one. |
| D15 | **Vital task.** The anchor reads `chart` and `ingest` rows minus withdrawn ones; any NEWS2 input counts. `NEWS2_HAND_CODES` becomes `NEWS2_INPUT_CODES` (alias kept). The device sends SpO₂, systolic pressure, pulse and temperature but **no respiration rate and no consciousness**, so after a device round the task resets and the card says the NEWS2 is partial. **Confirmed by the owner (§10 Q4).** | An unmatched reading writes no `ingest` row under a patient, so it resets nothing; a linked one does, at its own time. |
| D16 | **Patient screen: «Ölçüm kaydı» box** under «Ölçülen değerler». One row per measurement set, newest first, 24 h / 72 h / 7 days; source «cihaz · {device}» or «elle · {user}»; a withdrawn value struck through with its reason; an «alındı» time when arrival and measurement differ by more than 5 minutes; «Düzelt» per value for `clinical.chart` holders. Trends: each channel gains `device: […]` beside `manual`, and the trend table prints «cihaz» and offers «Düzelt». | One place to read what was measured in this stay and by what. |
| D17 | **«Eşleşmeyen ölçümler» lives inside the bedside page (`/olcum`)** as a step that reuses its patient list and identity question. The `olcum` rail item shows a count badge (polled every 60 s, neutral tone). | `/devices` is the biomedical page and shows no patient. No new route, no new lazy chunk. |
| D18 | **Device query: nothing changes** in `edge/pdq.py`, `pdq_client.py`, `bridge.py`, `mllp.py`, `api/edge_query.py`, `edge/adt.py`. `/ingest` keeps answering 200, so the bridge's uplink never blocks. | The HBYS input (§7) freezes that path until the HBYS decisions. |
| D19 | **The migration is schema-only.** `scripts/backfill_vital_readings.py --open-only --dry-run` runs `reconcile` without the 48 h bound for the keys admitted now, as an optional deploy step. | Fast and reversible (H1a precedent), with continuity for the patients in bed on the day. |
| D20 | **Rollback:** api + web to the previous images; `0021` downgrades by dropping the table and the audit index. Under the old images a withdrawn device value counts again (the old replay skips withdrawn `chart` rows only), linked readings stay (they are ordinary `ingest` rows), and unmatched readings are no longer visible. The rollback block first prints the three counts. | Honest rollback: what it restores and what it brings back (as G3-01 D16). |

## 3. Storage

**`vital_readings`** (tenant slug, sync engine, `text()` SQL, as `tasks` in 0017; no names, no permission rows):

- Identity: `id` bigserial PK · `tenant` varchar(64) · `received_key` varchar(128) NOT NULL (the number the
  door received) · `patient_key` varchar(128) NULL (the card key it is filed under; NULL while unmatched or
  rejected) · `admission_id` uuid NULL, FK `admissions(id)` ON DELETE RESTRICT.
- Reading: `code` varchar(32) · `value` float8 · `unit` varchar(16) · `observed_at`, `received_at` timestamptz
  · `origin` CHECK (`device`, `manual`) · `source` varchar(64) (the device string, or `clinician`) ·
  `recorded_by` varchar(128) NULL.
- State: `state` CHECK (`recorded`, `unmatched`, `assigned`, `rejected`) · `unmatched_reason` CHECK
  (`unknown`, `discharged`) NULL · `audit_id` bigint NULL (the arrival row) · `entry_id` bigint NULL (the
  engine row the retract route addresses) · `resolved_at`, `resolved_by`, `resolve_reason` varchar(200) ·
  `voided_at`, `voided_by`, `void_reason` varchar(200).
- Indexes: `(tenant, patient_key, observed_at)` · `(admission_id, observed_at) WHERE admission_id IS NOT NULL`
  · `(tenant, received_at) WHERE state = 'unmatched'` · UNIQUE `(tenant, audit_id) WHERE audit_id IS NOT NULL`
  · UNIQUE `(tenant, received_key, code, observed_at, source, value) WHERE origin = 'device'` (D14).

The same migration adds `ix_audit_tenant_patient_id ON audit (tenant, patient_id, id)` (`CREATE INDEX IF NOT
EXISTS`, as 0013 did). It closes G3-01's open item O3: the retract rebuild, trends and the single-patient task
read all filter on it.

Store pattern as `tasks`: `api/readings.py` (dataclass, Protocol, `InMemoryReadingStore`, `reconcile`, the
router), `api/readings_postgres.py`; `create_app(readings=None)` defaults to memory; `prodserver._readings(url)`
mirrors `_tasks`. The no-DB suite keeps running on memory.

**H2 later:** `visits` adds `visit_id` here, filled through `admission_id`, else by `visits.protocol_no =
patient_key`. `patient_key` stays the card key.

## 4. API

- **`POST /ingest`** (device token; unchanged for a matched reading except the table row and D14):
  - duplicate → `{"patient_id", "duplicate": true}`;
  - discharged number → audit `reading_unmatched` `{value, unit, obs_ts, device, reason: "discharged"}` +
    table row; the answer stays `{"patient_id", "dropped": "discharged"}`;
  - unknown number under policy `unmatched` → the same with reason `unknown`, answer `"dropped": "unmatched"`.
- **`GET /readings/unmatched`** (`clinical.chart`): the last 7 days, grouped:
  `{"count": n, "sets": [{"received_key", "reason", "source", "observed_at", "received_at",
  "readings": [{"id", "code", "value", "unit"}]}]}`.
- **`POST /readings/unmatched/assign`** `{"readings": [ids], "patient_id": key}` →
  `{"assigned": [ids], "patient_id", "alerts": [kinds]}`. Refusals: 409 `reading_not_unmatched`, 422
  `reading_set_mixed` (ids from two sets), 409 `reading_too_old`, 409 `reading_target_discharged`, 404 out of
  scope.
- **`POST /readings/unmatched/reject`** `{"readings": [ids], "reason": "…"}` (10–200 characters, 422
  `reading_reason_length`) → `{"rejected": [ids]}`; audit `reading_rejected`.
- **`GET /patients/{patient_id}/readings?hours=24|72|168`** (`board.view` + scope, beside trends and fluids):
  the patient's sets from the table, each value with `origin`, `source`, `recorded_by`, `entry` (for
  «Düzelt») and `voided: null | {reason, by, at}`.
- **`POST /clinical/{id}/entries/{entry}/retract`**: accepts device rows (D13). `RETRACT_UNKNOWN` is reworded
  (it says «elle girilmiş değer» today).
- **`GET /patients/{id}/trends`**: `device` per channel (D16).

Numbers and ids travel in bodies. The one new path that carries a key (`/patients/{id}/readings`) joins O10's
nginx mask and the route-walk test.

## 5. Engine and API changes (by file)

- `api/readings.py`, `api/readings_postgres.py` — new (§3, §4).
- `api/app.py` — `_apply_reading` extracted from `/ingest` with no behaviour change; `/ingest` routing (D8,
  D9, D14) and the table write; `/clinical` writes manual rows; the retract route's target lookup takes
  `ingest` rows; the patient readings route; the store and the policy wired in `create_app`.
- `api/rehydrate.py` — the two skips (`rehydrate` and `rebuild_patient`) cover `ingest` rows as well as
  `chart`.
- `api/clinical.py` — `RETRACT_UNKNOWN` wording.
- `api/trends.py` — `device` per channel, from the one audit read it already makes.
- `api/tasks.py`, `api/tasks_postgres.py` — D15; the key→admission fragment shared.
- `api/prodserver.py` — `_readings`, the production policy.
- `alembic/versions/0021_vital_readings.py`; `scripts/backfill_vital_readings.py`.
- `deploy/…/nginx.conf` — `/readings` in the API paths, the readings path in the O10 mask.

`api/fluids.py` reads `chart` and `chart_retract` rows tenant-wide, as `tasks` does, and Eczane's
`api/pharmacy.py` reads through it. It keeps only `chart` rows of the fluid codes, so a withdrawn device row
does not reach either. A test pins that.

## 6. Dashboard

- `backendApi.js`, `data/boardStore.js`: `patientReadings`, `unmatchedReadings`, `assignReadings`,
  `rejectReadings`.
- `screens/patient/readings/`: `ReadingsBox.jsx`, `useReadings.js` (the `useFluids` pattern), `CorrectDialog.jsx`
  (withdraw, then the corrected value; a message for the case where the withdrawal succeeded and the entry did
  not); mounted in `PatientScreen.jsx` under the vital cards. **B1b Nakil is editing `PatientScreen.jsx` now**;
  the mount is one line and merges late.
- `screens/patient/trends/`: `deviceEntryOf` beside `handEntryOf`; «cihaz» and «Düzelt» in `TrendTable`.
- `screens/bedside/BedsideScreen.jsx`: the «Eşleşmeyen ölçümler» step; `UnmatchedProvider` and the rail badge.
- Görevlerim: the wording that says a hand entry is needed.
- Strings in tr, az, ru, en: new `kayit.js`, additions to `olcum.js`, `denetim.js` (three new audit types:
  `reading_unmatched`, `reading_assigned`, `reading_rejected`), the refusal codes in `apiErrors.js`.
- `vite.config.js` dev proxy gains `/readings`.

## 7. Testing

**Engine** (tests first, per task of the plan):
- store: add, seen, dedupe, list by patient, unmatched list, claim / release / finalize, void, reject;
- Postgres: round trip; the admission stamp for an open, a DRAFT, a legacy H-key and a transferred
  admission; the two unique indexes; the audit index; downgrade; one alembic head;
- `/ingest`: a matched row carries `audit_id` and `admission_id`; a duplicate writes no second audit row and
  no engine point; `seen` raising still ingests; a table failure still answers 200; a discharged number is
  listed with its value and raises no alert, frame or notification; policy `unmatched` lists an unknown
  number and makes no card; policy `card` behaves as today (`test_a_reading_without_an_identity_still_makes_a_card`
  stays); a `prodserver` test pins the production policy;
- list / assign / reject: permission, device 403, the scope filter, every refusal code, a linked reading
  enters the engine at its own time with the device as source (NEWS2, alert, frame), a double assign is 409,
  a failed apply releases the claim, a restart replays the same picture;
- correction: a device row withdrawn → NEWS2 falls, the alert clears, the table row is voided, a re-send is a
  duplicate; `rehydrate` and `rebuild_patient` both skip it; the existing "device value cannot be withdrawn"
  test flips;
- vital task: a device reading anchors, a withdrawn one does not, a future-stamped one is ignored;
- `reconcile`: a missing recorded row, a missing void, an orphaned claim, idempotent when run twice;
- the other readers of withdrawals (Lane A, 2026-11-11): `fluids._entries_by_patient`, Eczane's
  `read_entries_by_patient` and `tasks._stamps_by_patient` pair a withdrawal with its (patient, entry); a
  `chart_retract` of a device row with a non-fluid code changes none of their answers;
- restart after a device withdrawal: the wider skip in `rehydrate` does not bring back an old
  acknowledgement for an alert that the replay now raises differently (the known "replay never prunes" risk);
  the test shows the episode's state equals the live rebuild's.

**Pins** (values at 331df704; re-read at branch time, other lanes move them): routes defined in `app.py` are
pinned by `test_board_permissions.py` `BOARD_EXPECTED` (27 → 28 with the patient readings route), routes of a
router by `test_route_permissions.py` `EXPECTED` (75 → 78) and `test_tenant_isolation.py`;
`test_route_inventory` +3 caller-resolved routes; nginx `API_PATHS` 32 → 33 (34 if Kalite's `/quality`
lands first) and the masked log line for `/patients/{id}/readings` (`test_access_log_redaction.py`);
`devProxy.test.js`; `SPEC_KEYS` 28 unchanged; dashboard `EVENT_TYPES` +3 with labels in four languages
(`engineTypes.test.js`); precache 67 unchanged.

**Dashboard:** client calls; `ReadingsBox` (sets, source, struck value, «alındı»); `CorrectDialog` (order of
the two calls, partial failure, hidden after 24 h); the trend tag; the unmatched step and the badge; the
raw-key sweep, four languages, two themes, 390 and 1440 px.

**Gates:** engine no-DB pytest; a Postgres subset on a throwaway container (readings, tasks, audit,
migrations, `alembic heads`); dashboard vitest; `vite build`.

**Local walk** (synthetic only: «Test Hasta», protocol `202600000001`; local stack; QBP and ORU from
`scripts/pdq_probe.py` and `scripts/hl7_simulator.py` over MLLP to the local bridge):
1. Admit. The probe answers with the name. An ORU set appears in «Ölçüm kaydı» as «cihaz», linked to the
   admission; the Görevlerim timer resets.
2. A typo (`202600000010`): the probe answers NF; the ORU makes no card; the badge and the list show the set;
   link it; it appears under the patient at its own time.
3. Discharge, then an ORU: the list shows it as «taburcu»; no alert.
4. «Düzelt» a device systolic value: NEWS2 and the trend change, the row is struck with its reason; re-send
   the same ORU: nothing returns.
5. Restart the API: the same picture.

## 8. Deploy

Main and the VM are the owner's word, through Lane A, which writes the blocks. What they must say:

- **Migration `0021`.** One statement per `op.execute`. Building `ix_audit_tenant_patient_id` locks the
  `audit` table, so audit writes wait for the build (the VM's table is small, about 2 400 rows). The deploy
  note says so. `down_revision` is `"0020"` if Kalite is on main first.
- **What the live board shows changes.** Today the VM has no policy switch: a reading under an unknown number
  makes a nameless card, and a reading for a discharged number vanishes. After the deploy, in production:
  - a new reading under an unknown number goes to the list and makes **no** card;
  - a nameless card that exists on the day stays (the restart replays its old `ingest` rows) but receives
    nothing new — the plan verifies this in a test and the guide says where such readings now go;
  - a reading for a discharged number appears in the list with its value.
  Block A-1 counts today's nameless cards so the owner knows what will stop updating.
- **The ward is told beforehand:** the «Eşleşmeyen ölçümler» list and its badge, «Düzelt» on a device value,
  and that a device round now clears the vital task while the NEWS2 stays partial without respiration rate
  and consciousness.
- **Rollback:** D20.

## 9. Not in this slice

- **Comed's protocol number** typed on the device (D1).
- **Ward unit types.** `UnitType` has the five ICU kinds only; servis units are HBYS H4. A ward patient can
  be linked only if admitted in Homunculus to a unit that exists today.
- **Viewing a discharged stay's readings** (owner question S14, B1a A-16). The table keeps the rows; no screen
  shows them yet. Linking a reading to a closed stay is out too.
- **A check digit.** A wrong digit that happens to be a neighbour's open protocol attaches to the neighbour.
  The name on the device and «Düzelt» are the remedies; the guide says so.
- **Respiration rate from the device**, a source tag on the vital cards, a NEWS2 per set in the box, a
  per-floor device registry.
- **The NCE feed.** It has been silent since 2026-09-05; reviving it is the owner's session (B1d O1–O6),
  which also settles what the device does on NF. Until then this slice is proven on the local stack only.
- **`visits`** (H2; §3 says how the table follows).

## 10. Open items

**Put to the owner and confirmed, 2026-11-11:**

- **Q1.** Who may link or reject an unmatched reading: everyone who can chart (`clinical.chart`), each action
  audited. (Not chosen: a new permission for charge nurses.)
- **Q2.** How old a reading may be and still be linked: 24 h. Older ones stay listed and can only be
  rejected; the value is kept either way. (Not chosen: 72 h, no limit.)
- **Q3.** Correction: the wrong value stays visible, struck through; a reason of at least 10 characters is
  required; the corrected value is recorded as «elle» at the reading's time.
- **Q4.** A device round with no respiration rate and no consciousness still resets the vital timer, and the
  card shows the NEWS2 as partial until they are entered by hand.

**Still open:**

- **O1.** Tests that post one identical reading twice now see a duplicate (D14). The fallout is known only
  when the task runs; each is fixed by giving the second reading its own time, never by weakening the rule.
- **O2.** An empty `device.display` replays as "replay", so the shadow lane's removal and the «already» repair
  comparison can miss a withdrawn device value. A test in the correction task; the source is stored as sent.
- **O3.** The tenant-wide task anchor read is capped at 20 000 rows (`HAND_LIMIT * 4`). Enough for spot-check devices; move the
  anchor to the table if a continuous monitor feed ever enters the real engine.
- **O4.** az/ru/en strings are read by a native reader after the deploy (as ESLEME O62).
- **O5.** Shared edits with other lanes at merge: `denetim.js`, `nginx.conf`, the pin tests, the guide's §
  number, `PatientScreen.jsx` (Nakil), the migration's `down_revision` (Kalite).

## 11. As built (2026-11-12, plan `docs/superpowers/plans/2026-11-11-g3-cihaz-olcum-kaydi.md`)

Branch `feat/g3-cihaz-olcum-kaydi`, head `33064adc` (`git log 7db97782..33064adc`: from the plan's commit to the final
review's last fix). Main was merged in twice: `cde137b3` (main `6ae20d83`: G4-03 Kalite `0020`, the i18n chunks, G2-B1b
Nakil) and `d4ffc4df` (main `da70c56f`: G4-04 İş yükü `0022`). **On the branch only — not on main, not on the VM
(2026-11-12)**; both are the owner's word, through Lane A. The guide's section is §3.27 of
`docs/homunculus-rehber-TR.md`.

### 11.1 Commits by task

Each task's feature commit, then its review fixes.

| Task | What | Commits |
|---|---|---|
| B1 | the store: the row, the protocol, the in-memory store, the contract | `626b8758`; `2a95536d`, `27edff2d` |
| B2 | migration `0021`, `PostgresReadingStore`, `admission_keys.py` | `5595e278`; `6090ea06` |
| B3 | `_apply_reading` extracted from `/ingest`, no change in behaviour | `956163e1` |
| B4 | both doors file the record; D14's re-send | `99da6d74` |
| B5 | the unmatched door and the policy switch | `9a18efbd`; `84a84ebe` |
| B6 | the list, the link, the rejection | `72a506d6`; `95a305b1`, `99559e24`, `7741a1e8` |
| B7 | «hatalı giriş» on device rows | `9986fb0b`; `1e712846`, `1e753442` |
| B8 | `GET /patients/{id}/readings`; trends' `device` | `2ad03761`; `02c88951`, dashboard `9300ca6b` |
| B9 | the vital task reads device rows | `a1f33371`; `b9a7372c` |
| B10 | `reconcile`, its hourly loop, the backfill script | `de87da68`; `dede43d7` |
| W1 | client calls, `kayit` strings, refusal codes (part A); Denetim's three types, the reworded sentence (part B) | `bcedf99d`, `11dfba71`; `30e9cf85` |
| W2 | the «Ölçüm kaydı» box, `CorrectDialog` | `126ff709`; `bfa865e1`, `f990a27a` |
| W3 | the trend table's «cihaz» and «Düzelt» | `4342c92c`; `a7d7593a`, `a844663c`, `ed33b5db` |
| W4 | the «Eşleşmeyen ölçümler» step, the rail badge | `ab3bc0db`; `5900388a`, `ed33b5db`, `7b0f53e0` |
| W5 | Görevlerim's partial-NEWS2 wording | `e3bf312d`; `23f1210b` |
| Final review | whole-slice review: I-1, minors 3–9 | `906f23dd`, `6d96ee95`, `33064adc` |

### 11.2 The decisions as they ended up — changes against the text above

- **D7 amended (B5 review, `84a84ebe`): the unmatched door answers 200 even when its table write fails.** `/ingest`
  writes the `reading_unmatched` audit row (with the value), tries the table row, logs a failure with its exception class
  and reason only, and answers the normal 200 (`dropped`). D7's «except on the unmatched path, which answers 500» no
  longer holds. Reason: the bridge's uplink is serial — on a 500 it stops and retries every 2 s, so one listed reading
  would stall the ward feed for every patient (no new values, no alerts), and each retry would write another
  `reading_unmatched` row. `reconcile` is the repair, and the only one for that row: it runs at start-up and hourly (a
  durable store only), over the audit rows written in the last 48 h, read from an id floor (`first_id_at_or_after`, a
  binary search; an audit without it is read from the start); a claim older than the window pulls the bound back to its
  own time (B10 review, `dede43d7`). It files row by row: a row the table refuses is counted `skipped` and logged once a
  pass by class (final review, minor 4). A failing pass is one WARNING per streak. Also part of D7 as built: a door's
  table row is filed by `_apply_reading`'s `on_written` right after the `ingest` row, before the alert, first-seen and
  notification rows and the frame (B6 independent review, I-2), so a tail that fails later leaves a row the re-send is
  recognised by; that `duplicate` re-send then finishes the tail once — first-seen stamp, notification, frame; no
  `ingest` or `alert` row (`_finish_resent`, `7741a1e8`).
- **D12 amended (B6 review, `95a305b1`): a LINKED reading is judged at the wall clock.** It keeps its own measurement
  time — stored, audited as `obs_ts`, drawn at it in trends and the record, anchoring the vital task at it — but
  `_apply_reading` evaluates it with `judge_at=now`, and a restart replays an `ingest` row that names a `reading` at the
  row's write time (`rehydrate._replay_ingest`), so the replay agrees. D12's «alert behaviour equals a back-dated hand
  entry: judged at its own time» no longer holds for a link. Reason: judged at its old time, a linked value ran the
  antibiotic clock, the sepsis and shock rules and the alerts' episodes backwards — an active or acknowledged
  `antibiotic_overdue` was replaced by `antibiotic_due` («300 min remaining»: false reassurance), and an acknowledged
  overdue's episode ended. Judged now, a stale value simply fails NEWS2's freshness. Not covered: the shadow lane (open
  item c). The record counts a linked reading as arrived when it was linked (`resolved_at`), so its «alındı» is the
  link's time (B8 review, `02c88951`).
- **New refusal: 409 `reading_before_stay` (final review I-1, `906f23dd`).** Protocol numbers are sequential, so a typo
  is often the next number, handed to a new patient hours after the round typed with it was measured. A set measured
  before the start of the stay of the patient who holds the number now — the first kabul, walked back along transfers
  (the task store's `ADMITTED_AT`), minus `BEDSIDE_SKEW` (2 min) — cannot be linked to that stay; the check precedes the
  claim. Such a set is visible to every `clinical.chart` holder, as an unknown number's set is, so the ward it was
  measured on can link it to its own patient or reject it. New store methods `stay_start` and `open_admissions`
  (protocol, memory, Postgres, contract); `open_stays` walks back to the first kabul; `admission_keys.OPEN_STAYS` was
  renamed `OPEN_ADMISSIONS`. No screen back-dates an admission (the kabul form sends no `admission_datetime`; the server
  stamps the moment the admission is saved), so a round measured just before a patient's kabul is charted by hand at
  its time (24 h at most) and the set rejected — the guide says so.
- **D11 as built.** Visibility is decided per number and measurement time: a number with no identity record → every
  `clinical.chart` holder; a number that is a patient's now — admitted since the set arrived (its reason stays
  `unknown`), or discharged — → only callers whose scope reaches that patient (a discharged one at the tombstone's last
  unit), the scope card built uncounted (B6 independent review, I-3); except a set measured before that patient's stay
  (above) → everybody. The scope is resolved once per request (503 when unreadable), each number's record read once per
  request. The link's target: in scope (404, audited `scope_denied`), not discharged (409), on a board — an identity
  record or a measured patient (E-5) — and, under the policy `unmatched`, never a nameless card (404; final review,
  minor 5).
- **Twins (D13, D14 as built).** One device reading the trail holds twice (a `seen` that failed open; older data) — two
  `ingest` rows with one `device_key`: patient, code, instant, the device as the table keeps it (cut to `SOURCE_MAX`),
  value — is one reading everywhere. The retract route writes one `chart_retract` naming the entry chosen and takes
  every copy: the engine replay and the live rebuild skip them (`skip_device`), trends mark every copy, the record
  shows every table row with the same `device_identity` withdrawn, the vital task skips every copy, and `reconcile`
  voids every copy's row (`_withdrawn_entries`); each void is tried per copy in its own `try` (`1e712846`). A retry of
  a finished withdrawal («already») also marks the record, with the trail's own withdrawal (`1e753442`). **A withdrawn
  reading re-sent is answered `duplicate`**, from a per-hospital in-memory set of withdrawn device keys (filled at
  rehydrate, added to at each withdrawal) asked before the store — so it holds when the store fails open or, in
  memory, forgot at a restart. D14's `seen` also matches a row FILED under the patient (`received_key` OR
  `patient_key`; B6 independent review, I-1).
- **One reading enters a patient once (D12 as built).** The link asks its target the narrower `filed_under` (a row whose
  `patient_key` is the patient — never a waiting, claimed or rejected row, so a set linked to the very number it arrived
  under does not match itself; `7741a1e8`). A reading the target already holds — or holds withdrawn (final review,
  minor 3; asked of memory first) — is not applied: its row is closed `rejected` with `RESOLVE_ALREADY_HELD`, the value
  kept, and named under `already_held` in the link's `reading_assigned` row. Before each reading of a set the target's
  identity is read again (a discharge in between releases the rest: 409 `reading_target_discharged`) and the claim is
  checked to be still this request's own (`_still_ours`: `assigned`, no patient, the same `resolved_by` and
  `resolved_at`; B10 review) — a lost claim stops the set with 409 `reading_not_unmatched`. A set that stops part-way
  gets a best-effort `reading_assigned` row for the readings that went in (a failed append is logged by class only).
  The linked `ingest` row carries `"reading": id` and `"actor"`, the person (B6 independent review, I-4). A raise
  mid-set releases only the readings not yet attempted; the one in progress stays claimed, for `reconcile` to finalize
  from its `ingest` row or release after `CLAIM_STALE` (`72a506d6`). `reconcile` finishes a claim only with a row of
  that claim's own person written after the claim was made (`dede43d7`).
- **Bounds (B6, B8 reviews; final review, minors 7 and 8).** The list reads at most `UNMATCHED_ROWS_MAX`
  (`LIST_MAX * SET_MAX` = 10 000) rows, the newest, cut in the database, and answers the newest `LIST_MAX` (200) sets
  with `"truncated": true` (`count` is then the sets among the rows read: a lower bound); the visibility decision is
  asked once per number and time. The record reads at most `RECORD_ROWS_MAX` (5 000) rows, to the answer's own `until`,
  with `"truncated": true` when cut. Trends read the device `ingest` rows on their own budget, `TRENDS_DEVICE_LIMIT`
  (5 000, the newest kept), so they never cut the hand entries or the withdrawals; the answer gains `device_truncated`
  beside `manual_truncated`. A durable store's list and record reads run off the event loop (`asyncio.to_thread`); the
  doors' check-then-file stays synchronous on purpose (`_resent`'s docstring). The dashboard says each cut as a neutral
  note (`kayit.umTruncated`, `recordTruncated`, `entriesTruncated`), and the rail badge and the step's button show the
  engine's `count`, never `sets.length`, and nothing unless the last read succeeded (`6d96ee95`).
- **D15 as built (B9 review, `b9a7372c`).** The anchor reads the `chart` and `ingest` rows of `NEWS2_INPUT_CODES` minus
  the withdrawn ones (twins by device key). The tenant-wide read keeps the newest `HAND_LIMIT * 4` (20 000) rows; when
  it comes back full, each board patient it gave no stamp is read again on its own (`hand_entries`), and the cut is
  warned once while it lasts — O3's risk is reduced for a busy feeder, the anchor still counts every reading of one
  (open item b). A task's `entries` lists each instant once.
- **D19 as built.** `--open-only` is required (E-11); each open stay is bounded by its start, walked back to the first
  kabul; a moved stay's readings from before the move are filed with `admission_id` NULL — the stamp is the open
  admission row's, which began at the move (final review, minor 6; open item d).
- **Migration `0021` as built.** `vital_readings` with **seven** indexes — the spec's five, E-2's
  `ix_vital_readings_tenant_entry`, and `ix_vital_readings_claims (tenant, id) WHERE state = 'assigned' AND patient_key
  IS NULL` (B2 review, `6090ea06`: `claims()` runs at every reconcile) — plus `ix_audit_tenant_patient_id` on `audit`.
  One statement per `op.execute`. After the merges the chain is `… 0019 → 0020 → 0022 → 0021`: `down_revision = "0022"`,
  one head, `0021`; an order check reads the revision graph, never the names.
- **Smaller.** `POST /clinical/{id}` and its preview refuse a path id longer than `PATIENT_ID_MAX` (400; minor 4). Every
  log line of the slice names the hospital and an exception class, never a number or a value (B6 independent review,
  M1). The policy switch reaches the container: `deploy/local/docker-compose.yml` passes `READINGS_UNKNOWN_KEY` (empty
  by default); a value other than `card` or `unmatched` is warned about and ignored — the list stays — and the policy
  in effect is logged once at start (`prodserver._unknown_readings`). Spec O2 is closed (E-8: an `ingest` row's device
  replays as sent). O3 is reduced (above), O4 stays open (item e), O5's shared edits were settled at the two merges.

### 11.3 The plan's departures, briefly

E-1 the three list routes are a factory router's, pinned by `CALLER_RESOLVED_ROUTES` and `test_tenant_isolation.py`,
not by `EXPECTED`; E-2 the sixth index, `(tenant, entry_id)`, for the withdrawal's mark; E-3 the claim also guards a
rejection, and an orphaned claim is released after `CLAIM_STALE` (10 min); E-4 `linkable` on a list set, `received_late`
on a record set, decided by the engine; E-5 the link's target must be on a board; E-6 one rejection is one set; E-7
`hours` outside 24/72/168 is a coded 400 `reading_hours`; E-8 O2 fixed — an `ingest` row's device replays as sent; E-9
the dev proxy line travels with nginx's, and W1 has two parts; E-10 the dashboard reads through hooks and writes through
the board store; E-11 the backfill requires `--open-only` and bounds each stay by its start; E-12 `source` and `unit`
are cut to 64 and 16 characters at the door.

### 11.4 The pins, after the merge of main `da70c56f`

`test_route_permissions.py` `EXPECTED` **77** (this slice adds none, E-1; other lanes moved it from 75) ·
`test_board_permissions.py` `BOARD_EXPECTED` **28** (+ `GET /patients/{patient_id}/readings`) ·
`test_route_inventory.py` `CALLER_RESOLVED_ROUTES` **13** (+ the three `/readings/unmatched…`) ·
`test_tenant_isolation.py` `UNSCOPED_BY_DESIGN` **43** (with the set `UNMATCHED_READINGS`, 3) · `test_permissions.py`
`SPEC_KEYS` **30** (no new permission, D10) · `test_nginx_routes.py` `API_PATHS` **35** (+ `/readings`), the log map's
`/patients/:key/readings`, the dev proxy's `/readings` · `denetim.js` `EVENT_TYPES` **61** (+ `reading_unmatched`,
`reading_assigned`, `reading_rejected`) · the `kayit` namespace **79** keys in each of tr, az, ru, en.

### 11.5 Open items for the owner

- **(a) A back-dated reading can still turn `antibiotic_overdue` into `antibiotic_due` — engine-wide, older than this
  slice.** A buffered Connex round arriving late at `/ingest`, or «Düzelt»'s corrected value charted at the reading's
  time, is judged at its own measurement time (the door's `min(stamp, wall clock)`, G2-A2 X10; the bedside door's
  back-dating, G3-01 D7), so it can replace an active or acknowledged overdue with a «due» — the false reassurance the
  D12 amendment removed for links only. The fix touches G2-A2 X10 and G3-01 D7: the owner's decision.
- **(b) A continuous feed and the vital task.** «Any NEWS2 input counts» (D15): when a MEDIBUS ventilator feed goes live
  into the real engine, that patient's vital task never comes due. To be decided before such a feed is switched on.
- **(c) The shadow lane** (`mirror_observation`) still judges a linked reading at its measurement time, inside its own
  engine. Non-clinical; left as it is.
- **(d) Pre-move readings.** Readings of a transferred patient from before the move, filed by `reconcile` or the
  backfill (not by the door), carry `admission_id` NULL; the record box still shows them (it reads by card key).
- **(e) az/ru/en strings** await a native reader (O4).
- **(f) The NCE feed** has been silent since 2026-09-05; its revival is the owner's session (B1d O1–O6), which also
  settles what the device does on `NF`. The slice is proven on the local stack only.

### 11.6 Deploy notes for Lane A

What the blocks must say; Lane A writes them, the owner's «onay» runs them.

- **Images: api + web only.** The bridge, the NCE reader, the hub and the workers are untouched — the device query
  path did not change (D18). Order: bundle → dump → api (its start command runs `alembic upgrade head`, then serves) →
  web → checks. In a pasted heredoc every stdin consumer (`docker compose exec|run`, `psql`, `ssh`) takes `</dev/null`.
- **Migration `0021`, after `0022`.** `alembic heads` prints one head, `0021`, before the deploy. Schema only, one
  statement per `op.execute`. `ix_audit_tenant_patient_id` is a plain `CREATE INDEX IF NOT EXISTS` on `audit`: it takes
  a SHARE lock that Postgres holds until the transaction commits — and env.py runs every pending revision of one
  `alembic upgrade head` in a single transaction, so on a server that also lacks `0020` and `0022` the lock lasts until
  the whole `upgrade head` commits. Audit writes wait that long; the API does not serve until the upgrade has finished.
  The VM's `audit` table was about 2 400 rows when the spec was written (§8): a moment. Rollback is a downgrade to
  `0022` (below).
- **`READINGS_UNKNOWN_KEY` stays empty in production** (the API's `.env`): on Postgres the policy is then `unmatched` —
  an unknown number goes to the list and makes no card. The API logs the policy once at start («… kept in the
  unmatched list and makes no card (policy unmatched)»). `card` is for a replay of recorded data into a deployment with
  no admissions only.
- **Block A-1 (before) counts today's nameless cards AND those of them with an alert on the card**, so the owner knows
  what will stop updating. A sketch from the plan, extended (Lane A checks it on the local stack; it prints two numbers,
  never a patient id): `docker compose exec -T api python -c "import os,json,urllib.request as u;
  t=os.environ['TENANTS'].split(',')[0].split(':')[0]; r=u.Request('http://127.0.0.1:8000/patients',
  headers={'Authorization':'Bearer '+t}); ps=[p for p in json.load(u.urlopen(r))['patients'] if p.get('identity') is
  None]; print(len(ps), sum(1 for p in ps if p.get('alerts')))" </dev/null`. After the deploy such a card stays (the
  restart replays its old `ingest` rows), receives nothing new and is no link target.
- **Checks after the start.** `select version_num from alembic_version` = `0021`; the seven `vital_readings` indexes and
  `ix_audit_tenant_patient_id` exist; the API's log has the policy line (`policy unmatched`) and no `vital_readings:`
  line at ERROR or WARNING level; `GET /readings/unmatched` without a credential through nginx answers 401 with a JSON
  body (not the dashboard's HTML); a web asset grep finds the `kayit` namespace (e.g. the key `umOpenCount`). **Not**
  «`count(*) from vital_readings` = 0»: the start-up reconcile files the last 48 h of `ingest` rows and bedside `chart`
  rows at once (logged at INFO as `vital_readings: reconcile (hastane …): recorded N`).
- **Optional, the same day (D19):** `docker compose run --rm --no-deps -T api python scripts/backfill_vital_readings.py
  --tenant <slug> --open-only --dry-run </dev/null`, read the one `VITAL_READINGS_BACKFILL {…}` line (counts only:
  `stays`, `recorded`, `skipped` …), then the same without `--dry-run`. It files the open stays' readings since each stay
  began; rows the start-up pass filed already are passed over; a second run files nothing. Exit 1: run it again; exit
  2: refused (no `--tenant`, no `--open-only`, no Postgres `DATABASE_URL`), nothing read.
- **The ward is told beforehand:** the «Eşleşmeyen ölçümler» list in «Yatak başı ölçüm» and its badge; «Düzelt» on a
  device value; a device round now clears the vital task while the NEWS2 stays partial until respiration rate and
  consciousness are entered by hand; a wrong digit that happens to be another in-patient's open protocol attaches the
  reading to that patient — the name on the device and «Düzelt» are the remedies; a set measured before a patient's
  stay cannot be linked to that stay.
- **Rollback (D20):** api + web to the previous images; `alembic downgrade 0022` (the revision before `0021` now — not
  `0019` or `0020`) drops the table with its rows and the audit index; no audit content is touched. The rollback block
  **first prints three counts** (as G3-01's R-1, a non-zero first count is worth the owner's confirmation before
  anything is touched):
  - `select count(*) from audit where event_type = 'chart_retract' and payload->>'origin' = 'device'` — withdrawn
    device values: under the old images each **counts again** (the old replay skips withdrawn `chart` rows only) and
    can raise its alert again;
  - `select count(*) from vital_readings where state = 'assigned' and patient_key is not null` — linked readings: they
    **stay** (ordinary `ingest` rows), but the old replay judges them at their measurement time, not at the link's (the
    D12 amendment does not survive a rollback);
  - `select count(*) from vital_readings where state = 'unmatched'` — waiting readings: **no longer visible** (their
    `reading_unmatched` audit rows remain); under the old images an unknown number makes a nameless card again and a
    discharged number's value is dropped again.

### 11.7 As run (local walk)

The local walk's record lives in `/c/tmp/homunculus-plans/g3-cihaz/walk/notes.md` (29 screenshots beside it). It ran
on 2026-11-12 against images built from `33064adc`, on a separate compose project (`g3cihaz`, containers `g3walk-*`;
another lane's stack was up), synthetic data only (tenant `cihaz-yuruyus`, «Test Hasta», protocol `202600000001`, typo
`202600000010`). Result: **five of five items pass**, plus the extra check.

1. Admit, device round: the probe answered with the name; five `recorded` device rows carry the admission id; «Ölçüm
   kaydı» shows the set as «cihaz»; the NEWS2 is partial; Görevlerim's vital task is anchored on the round.
2. Typo: the probe answered `NF`; no card was made; badge, list and identity question showed the set; the link put it
   in the record at its own measurement time, marked «alındı» when linked late; the link's alert rows carry the link
   time (D12 as amended).
3. Discharge: the reading was listed «taburcu edilmiş hastanın numarası»; no ingest, alert or notification row.
4. «Düzelt»: the device value struck through with reason, name and time, the hand value at the same time; NEWS2 3 → 0;
   the trend table shows «cihaz» struck and «elle»; the same ORU re-sent answered `duplicate`.
5. API restart: card, NEWS2, record, trend table and list identical (one channel aged out by the clock meanwhile).

Extra: a set measured 2 min 33 s before a new stay began was refused with `reading_before_stay` and its Turkish
sentence; one measured 42 s before linked, inside the 2-minute tolerance, as designed.

Finding W-1 (layout): at 390 px the unmatched list row squeezed its text to one word per line and drew the button over
the values — fixed after the walk (the buttons wrap under the text on a phone). Observations outside this slice, for
their owners: error toasts do not dismiss themselves; Görevlerim's shift line read «12:00 → 12:00» although shifts were
set at 8 and 20; a full page load of `/#/kabul` once showed «Bu sayfa yok». Setup the plan did not foresee: a site
mapping, first sign-in with 2FA, a building before the unit, test-only NEWS2 band intervals, and a «Sorumlu Hekim» user
to sign the admission and start the discharge.

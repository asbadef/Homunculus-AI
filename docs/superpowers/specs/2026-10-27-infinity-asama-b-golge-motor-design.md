# Infinity · Aşama B — the shadow engine: monitor values reach the rules, every alarm stays off — design

**Date:** 2026-10-27 · **Lane:** A (patient & engine) · **Branch:** `feat/infinity-asama-b`, created off `main` at
`377033f` (NBP + A1 + A2 + A-11 + A3 + the shell hotfix). **Runs after** Lane B's B1a (`kabul` admissions with their
own `bed_id`, migration 0012, the device→bed table v2 with bed UUIDs, the ward structure for every reanimation bed)
is on `main`. **Owner decisions (2026-10-27, six questions):** S1 = the core parameter set, S2 = one sample per
minute, S3 = HR→PLS and ART→NBP priority, S4 = 30-day sample retention, S5 = values on the card and a "shadow
finding · alarm off" box, Y = a second engine (the shadow engine), not a tagged observation in the real one. The
parent design is `/c/tmp/homunculus-plans/2026-10-14-infinity-klinik-pano-tasarim.md` (§2.3, §3.2–3.3, §4, §5 row
B, §6, §8); Aşama A is `docs/superpowers/plans/2026-10-15-infinity-asama-a-golge.md`. Code references were read at
`377033f`.

## 1. The problem

Aşama A puts the bedside monitors' values on the board in a dashed "doğrulanmamış" strip and feeds them to nothing
(`api/infinity_shadow.py`, `edge/infinity_shadow.py`). The engine still scores NEWS2 and the sepsis rules from the
observations that reach `/ingest` and `/clinical/{id}` — and since 2026-09-05 nothing reaches `/ingest`: the NCE feed
is silent (user decision 26.10: leave it). So today a reanimation patient with a heart rate of 140 and an SpO₂ of 86
on the monitor is, for the rules, a patient with no vitals. The ward sees the numbers in the strip and no finding.

Aşama B is the parent design's `rules` stage: "monitor values enter the rules, alarms stay off". The clinician must
see what the rules would say with the monitor's numbers, in a form that cannot be mistaken for an alarm, and nothing
that rings, pages, escalates or counts today may change by one bit. That last sentence is the gate, as it was for A
(`tests/test_infinity_shadow_equivalence.py`, `tests/test_infinity_shadow_isolation.py`).

**Validation.** The parent design (§4.2, §8.5) asks for a signed per-parameter validation before `rules`. The owner
closed K1 on 26.10 (BED05, BED06, BED25 compared at the bedside: the same values) and stated on 26.10 that the
monitors' values are verified. This spec records that decision as the entry gate's validation (departure V1, §9)
and keeps the allowlist per parameter so that a parameter the ward doubts can be switched off without a deploy.

## 2. Decisions

| # | Decision | Why |
|---|---|---|
| D1 | **A second `Engine` per hospital — the shadow engine (Y).** The real engine, `AckStore`, `sync_alerts`, `notifier`, `hub`, `alarm_quality` and the audit's `ingest`/`alert`/`first_seen` rows are untouched. Every clinical write that reaches the real engine (`/ingest` observation, `chart_observations` in `api/clinical.py`, `PUT /clinical/{id}/profile`, `Engine.forget` on discharge) is **mirrored** into the shadow engine right after the real call, inside a guard that logs and never fails the request. Monitor samples go **only** to the shadow engine. | The real engine's alerts are what rings; a monitor systolic in the same state would overwrite a charted one and move a real NEWS2 (option 2's leak). Two engines keep "alarm off" a structural fact, and the equivalence test proves it the way it proved Aşama A. |
| D2 | **Parameters (S1):** `hr`, `pls`, `spo2`, `art_systolic`, `art_mean`, `nbp` (systolic, mean) are **allowed**; `respiration`, `temperature`, `art_diastolic`, `etco2` are **off**. The allowlist is `INFINITY_RULES_PARAMETERS` in the API's environment, default `hr,pls,spo2,art_systolic,art_mean,nbp`; a name outside `PARAMETERS` makes the stage `off` with the problem `parameters_unknown`. | The parent design §8.4: RESP is not screen-verified (`EVIDENCE` "range_overlap"), temperature's site is unknown; NEWS2 weighs RESP heavily. A later one-line change opens them after a bedside look. |
| D3 | **Mapping and priority (S3), one feeder per signal:** `HEART_RATE` ← `hr` when its cell is a value, else `pls` when a value; `SBP` ← `art_systolic` when a value, else `nbp` systolic when a value and its `measured_age_s` ≤ 3600; `MAP` ← `art_mean`, else `nbp` mean under the same rule; `SPO2` ← `spo2`. A cell that is `invalid` (`***`), `old`, or withheld feeds nothing. The source is written into `Observation.source_device` as `infinity:<ip>:<hr|pls|art|nbp>` and shown on the card. | §6.5 of the parent design: one source per (patient, signal), the swap visible. NBP's `changed_at` is an upper bound of the cuff's time, so NBP's observation is **stamped at `changed_at`**, not at the packet; NEWS2's one-hour window then judges it by its measurement time (`rules/news2.py:228-230`). ART, HR, PLS and SpO₂ are stamped at `captured_at`. |
| D4 | **Sampling (S2):** per (patient, engine code) at most one observation per **60 s** (`SAMPLE_INTERVAL_S`), taken from the shadow store's current view at the moment a forwarder body is accepted (`POST /infinity-shadow/readings`, every ~5 s). No timer thread: a silent forwarder stops the sampling by itself, and nothing runs when nothing arrives. A minute with no value, `***` or an old cell is skipped, not back-filled. | NEWS2 reacts within a minute; the audit and the sample table stay at ≈ 6 rows/min/bed. Driving it from the POST keeps the lane's only clock the one it already has. |
| D5 | **Identity (parent K3/K5), unchanged from `board_view`:** a device feeds a patient only when the approved table's row valid now puts it on a bed (`bed_id`, a UUID in table v2) and `_occupants` finds **exactly one** admitted patient there (`kabul` by its own `bed_id`, every other record through the bed map). Two monitors on a bed, two patients on a bed, a bed without `bed_id`, a device outside the table, a `kabul` record that is a tombstone: no sample. The link is **forward only**: a sample is never written for a time before the link was seen. When a bed's patient changes, the old patient's monitor-sourced observations are **dropped** from the shadow engine's state (all of them, NBP included), the new patient starts from the next sample. | The one wrong-patient path is the explicit binding; nothing is guessed. `docs/INFINITY-PARAMETER-RECORDS.md:155-156` promised the NBP reset at a link change. |
| D6 | **The board (S5):** `patient_board` gains `shadow` — `null` for a patient without a monitor link, else `{"news2": {...the shadow engine's NEWS2 line...}, "vitals": {code: {value, unit, at, source}}, "findings": [{kind, severity, urgency, summary, evidence, since, relation}]}` where `relation` is `same` (the real engine has this kind at this severity), `shadow_only` (only the shadow engine has it) or `level_differs`. The real `risk`, `alerts`, `news2`, `latest` and `sofa` keys are built exactly as today. | The card can say what the monitor adds without touching what rings. `shadow_only` is the weekly "would have alerted" list's criterion. |
| D7 | **The screens:** the patient screen's «Ölçülen değerler» shows the shadow vitals with a neutral tag `monitör · HR` / `PLS` / `ART` / `NBP` and the time, beside (never replacing) the charted ones; a new box **«Gölge öneri · alarm kapalı»** lists the shadow NEWS2 score with its inputs and the shadow findings with their relation; the bed card carries one amber tag («gölge öneri · NEWS2 7» or «gölge öneri yok») under the strip. The Alarmlar screen, the bell, notifications, escalation, the alarm-quality counters: nothing. Settings gains «Uyarsaydı — son 7 gün», read from `GET /infinity-shadow/findings?days=7`. | Amber is this interface's "cannot vouch" colour (Decision 14 of A); a shadow finding is advice from unvalidated-fed rules and is dressed so. |
| D8 | **Records:** monitor samples go to a new table `monitor_samples` (migration **0013**, after Lane B's 0012): `hospital, patient_id, bed_id, source, code, via, value, unit, captured_at, received_at`, index `(hospital, patient_id, captured_at)`; an hourly task deletes rows older than **30 days** (S4). A shadow finding's opening and clearing are audit events `shadow_alert` / `shadow_alert_cleared` (payload: kind, severity, urgency, summary, the monitor sources used), kept for ever like every audit row. **No `ingest` row** for a monitor sample: the real engine's replay must never see one. | Samples are bulk and expire; findings are few and are what the weekly review and an auditor read. |
| D9 | **Restart:** `create_app` rehydrates the real engine as today (`rehydrate`, `iter_records`), then `shadow_engine = copy.deepcopy(engine)` and replays the last **24 h** of `monitor_samples` into it, oldest first; the sampler's per-(patient, code) last-sample clock is seeded from the newest replayed sample. The shadow engine's monitor observations older than 24 h are pruned on each sample (the repository drops observations whose `source_device` starts with `infinity:` and whose stamp is older). | One deep copy instead of a second replay of the whole audit; 24 h covers every window a rule reads (NEWS2 1–2 h, hold 8 h, SOFA's 24-h worst). Memory stays at 13 beds × 4 codes × 1440. |
| D10 | **The stage switch:** `INFINITY_CLINICAL_STAGE=rules` turns the sampler, the mirror, the `shadow` board key and the findings route on; `shadow` keeps Aşama A exactly as it is (sampler and mirror off, `shadow: null`, the box and tags absent, 409 on the findings route); `off` and `alarms` as today (`alarms` still `stage_not_implemented`). Changing the stage is a `.env` edit and `up -d --no-build api`; going back to `shadow` ends every shadow finding with one `shadow_alert_cleared` row (`reason: stage`). | The parent design's one-switch rollback per stage. |
| D11 | **The gate, extended:** `test_infinity_shadow_equivalence.py` runs its two apps a third time with the stage `rules` and the lane fed; every clinical output (board keys other than `shadow`, audit rows other than `shadow_*`, notifications, acks, escalation) must be identical to the stage-`off` run. `test_infinity_shadow_isolation.py` holds the new module `api/infinity_rules.py` to importing neither `notify`, `ackstore`, `alert_lifecycle` nor `alarm_quality`, and to writing audit rows only of the two shadow kinds. | The same proof as A, for B. |
| D12 | **Security hygiene in the same slice:** `create_engine`/`create_async_engine` in `db.py`, `api/audit_postgres.py` and `api/patient_identity_postgres.py` get `hide_parameters=True`. | Lane B's finding of 27.10: a 500 on an INSERT logs bound parameters, among them clinical free text. One flag, Lane A's files. |
| D13 | **Not here:** stage `alarms` (C); RESP and temperature (allowlist); device episodes (parent K4); an NCE/HL7 second source (the feed is off); the "this monitor's number is discharged" strip note (an NCE-feed case, O4); the hospital's written acceptance (parent §8.12, the owner's); trend charts of monitor samples beyond what the shadow engine holds (O3). | Each is its own decision. |

## 3. Components

- `homunculus-engine/src/homunculus/api/infinity_rules.py` (new) — `RulesSettings` (allowlist, from the environment
  through `shadow_settings_from_env`'s pattern), `pick(view: DeviceView, allowed) -> list[Candidate]` (D3, pure),
  `Sampler` (per-(patient, code) clock, D4; `tick(devices, table, occupants, now) -> list[Observation]`),
  `ShadowLane` (holds the shadow engines per hospital, `mirror_observation`, `mirror_profile`, `forget`, `sample`,
  `findings(patient_id)` with the relation of D6, `unlink(patient_id)` of D5). Imports `infinity_shadow` for the
  views and `pipeline.Engine`; nothing from `notify`, `ackstore`, `alert_lifecycle`, `alarm_quality`.
- `homunculus-engine/src/homunculus/state/repository.py` — `prune_source(prefix, before)` on the repository and
  `PatientState.drop_source(prefix)` (D5, D9).
- `homunculus-engine/src/homunculus/api/monitor_samples.py` (new) — the table's writer/reader (`append`,
  `since(hospital, hours)`, `prune(before)`), Postgres through the audit's engine; in-memory for tests.
- `homunculus-engine/migrations/0013_monitor_samples.py` (new).
- `homunculus-engine/src/homunculus/api/app.py` — the mirror calls in `/ingest` (after `engine.ingest`), in
  `chart_observations` (`api/clinical.py`), in the profile door and in `retire_patient`; the sampler call at the end
  of `shadow_readings`; the restart sequence (D9); `GET /infinity-shadow/findings`; the hourly prune.
- `homunculus-engine/src/homunculus/api/board.py` — `patient_board(..., shadow=...)` adds the `shadow` key (D6).
- `homunculus-engine/src/homunculus/db.py`, `api/audit_postgres.py`, `api/patient_identity_postgres.py` — D12.
- `dashboard/src/live/screens/patient/PatientScreen.jsx`, `screens/common/vitals.js` — the monitor-sourced vitals
  with their tag; `screens/patient/shadow/ShadowFindingsBox.jsx` (new) — the box of D7;
  `screens/beds/BedCard.jsx` — the amber tag; `screens/settings/SettingsScreen.jsx` — the 7-day list;
  `data/boardStore.js` — passes `shadow` through; `i18n/strings/*.js` — the new keys in four languages.
- Tests: `tests/test_infinity_rules.py` (pick, sampler, lane, unlink, prune, findings relation),
  `tests/test_monitor_samples.py`, `tests/test_api_shadow_findings.py`, the extended equivalence and isolation
  tests, `test_api_board_shadow.py`; dashboard `ShadowFindingsBox.test.jsx`, `BedCard.test.jsx`,
  `PatientScreen.test.jsx`, `SettingsScreen.test.jsx`, `strings.test.js`.
- Docs: `docs/homunculus-rehber-TR.md` («Gölge öneri» for the ward: what it is, what it is not, the sources' tags),
  `deploy/infinity/README.md` (the stage, the allowlist, the migration, the rollback), the roadmap row.

## 4. Data flow

`POST /infinity-shadow/readings` → `shadow_store.ingest` (as today) → **if stage `rules`:** `lane.sample(now)`:
`shadow_store.devices(now)` + `shadow_table.current()` + `_occupants(hospital, now)` → for each bed card with
`link == "one"`: `pick(view, allowed)` → for each candidate whose (patient, code) clock allows a sample:
`Observation(patient_id, code, value, unit, stamp, "infinity:<ip>:<via>")` → `shadow_engine.ingest(obs, now)` →
`monitor_samples.append(...)` → the shadow engine's active alerts for the patient are compared with the last
published set → `shadow_alert` / `shadow_alert_cleared` audit rows for the difference → `broadcaster.publish(
patient_board(engine, patient_id, store, ..., shadow=lane.findings(patient_id)))`.

A clinical write (`/ingest` observation, a chart, a profile, a discharge) → the real engine, the lifecycle, the
audit, the frame, the notifications **exactly as today** → then `lane.mirror_*` (a no-op below `rules`), guarded.

`GET /board` and the stream frames carry `shadow` per patient (D6); the dashboard draws D7 from it. The strip
(`/infinity-shadow/board`) is unchanged and still shows the raw values with their evidence.

## 5. Errors and edge cases

- **The shadow lane fails** (an exception in the sampler, a full table, a bad row): logged once per change of
  state, the clinical request still answers 200, the strip still shows; the device screen says
  «gölge motor: hata» from `feed.rules_state`.
- **Two patients on a bed, two monitors on a bed, no bed:** no sample, no shadow key (`null`), the strip's
  `link_reason` says why (as today).
- **The bed's patient changes:** `unlink(old)` drops the old patient's monitor observations from the shadow
  engine and clears their shadow findings (`shadow_alert_cleared`, `reason: unlinked`); the new patient's first
  sample comes within a minute.
- **Discharge (A-11):** `retire_patient` → `lane.forget(patient_id)` → the shadow engine forgets as the real one
  does; a tombstone is never an occupant.
- **NBP older than an hour, ART present and valid:** ART feeds SBP/MAP; NBP is ignored for the rules (still on the
  strip). **ART `***`, NBP 50 min old:** NBP feeds, stamped at its `changed_at`, tagged `NBP`.
- **A charted systolic and a monitor systolic in the same hour:** the shadow engine holds both; `latest()` is the
  newer stamp (the monitor's, every minute). The real engine never sees the monitor's.
- **A restart:** the shadow engine is the real engine's copy plus 24 h of samples; findings are recomputed from the
  replayed samples before the first frame; nothing is re-audited for them (the audit rows written before the
  restart stand; a finding that is still open after the replay is not opened twice — the lane seeds its
  "last published set" from the open `shadow_alert` rows of the last 24 h).
- **Clock:** samples are stamped by the hub's `captured_at`/`changed_at`, judged at `min(stamp, wall_now)` as every
  door does (A2 X10); the shadow store already refuses a packet more than 2 s ahead.
- **Stage `rules` configured with a problem** (token, hospital, unknown parameter): the stage runs `off`, the
  problem is shown on the device screen, exactly as A's problems are.

## 6. Tests

- Engine: `pick` chooses per D3 (each branch, including NBP's one-hour rule and its `changed_at` stamp); the sampler
  takes at most one per 60 s per (patient, code), skips `***`/old, never back-fills; `unlink` drops only
  `infinity:` observations of that patient; prune keeps 24 h; `findings` relations `same`/`shadow_only`/
  `level_differs`; the mirror reaches the shadow engine and not the real one twice; the lane below `rules` is a
  no-op; a lane exception does not fail `/ingest`.
- API: `shadow` on the board for a linked patient and `null` otherwise; `shadow_alert` rows on open/close and
  none on a restart replay; `GET /infinity-shadow/findings` scoped like the board; 409 below `rules`; the
  restart sequence (deep copy + 24 h replay) reproduces the findings of a run without a restart.
- Gate: the equivalence test's third run (`rules`, fed) — every clinical output identical to `off`; the isolation
  test's import and audit-kind checks on `infinity_rules.py`.
- Dashboard: the box renders the score, inputs and findings with relation words in four languages; the bed tag;
  the vitals tag per source; the Settings list; `strings.test.js` parity and az≠tr; `vite build`.
- Migration 0013 applies on a 0012 database (`tests/test_migrations.py`'s pattern).

## 7. Out of scope

Stage C; RESP/temperature; episodes; the NCE second source; the written hospital acceptance (the owner's, before the
stage is switched on the VM); the hub (nothing changes on the hub or the worker: the forwarder already sends every
parameter the lane needs).

## 8. Open items

- **O1** Patient-relative baselines (`BaselineForm`, "the patient's own normal") already shape the shadow findings
  through the mirrored profile; the ward may want the baseline fields back on the card for monitored patients.
- **O2** The weekly review's acceptance figures (how many `shadow_only` findings per week are acceptable before C)
  have no source in the vault; the clinician's figure is needed before C (parent §8.5, §5 row C).
- **O3** Trend charts: the shadow engine holds 24 h of samples; a 72-h chart of monitor values needs the table
  read into `patient_trends`. Not in this slice.
- **O4** An NCE reading landing on a discharged number is dropped silently (A-11, audit only); Lane B suggests a
  strip note. The NCE feed is off; revisit if it returns.
- **O5** `pls` as the pulse source when `hr` is `***`: the clinician may prefer HR-only (S3 chose the fallback);
  one line in the allowlist turns PLS off.

## 9. Departures from the parent design

- **V1** The signed per-parameter validation (§4.2, §8.5) is replaced by the owner's bedside confirmation of 26.10
  (K1 closed, "the monitors are verified"). Recorded here; the allowlist keeps each parameter switchable.
- **V2** NBP enters the rules (§8.4 kept it out until its time was verified): the NBP slice (22.10) gives the
  change time as an upper bound and the one-hour rule of D3 bounds its staleness.
- **V3** `art_mean` enters (its evidence is "structural", partial): the owner's S1. Shown with its partial tag on
  the strip as before.

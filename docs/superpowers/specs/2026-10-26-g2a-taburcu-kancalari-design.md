# G2-A11 · Taburcu kancaları: a discharged patient leaves the alert world — design

**Date:** 2026-10-26 · **Lane:** A (patient & engine) · **Branch:** `feat/g2a-a11`, created off `main` at `1bc5b34`
(A2 merged). **Origin:** Lane A's review of Lane B's B1a Task 5 (`913e572`, `98eb1b1`) and the amendments A-11a–f
agreed with Lane B on 2026-10-26 (`/c/tmp/homunculus-plans/g2b1a/amendments.md`, Lane B's copy; Lane A's running notes
in `/c/tmp/homunculus-plans/g2v/open-items.md`). **Clinician-owner decision (2026-10-26, via Lane B):** readings for a
discharged admission are dropped before the engine, with an audit row; no alert and no page results from them.

Code references were read at `1bc5b34`.

## 1. The problem

B1a (Lane B) adds admissions made in Homunculus itself: an identity record with `source = "kabul"`, keyed by the
Homunculus patient number. When such a patient is discharged the record stays as a **tombstone** (`state =
"discharged"`, never pruned) so that readings still arriving for the number — the monitor keeps the old number until
someone changes it — never bring a nameless card back; the board omits it (`_is_tombstone`, `913e572`).

Nothing on Lane A's side knows about that. At `1bc5b34`:

- **`/ingest` evaluates every reading** (`api/app.py:780–822`): engine state is created, `sync_alerts` runs, first-seen
  stamps are written, the escalation cycle (`:309–345`) pages the doctor. The board hides the card, the pager does not:
  a clinician is paged for a patient they cannot see.
- **The alerts raised before discharge never end.** A1 ends an alert only when its rule stops firing at the next
  evaluation (`api/alert_lifecycle.py:76–101`). Once readings are dropped (the owner's decision) no evaluation comes,
  so a HIGH alert from before discharge stays active for good: on `/alerts/{id}`, in `/alarm-quality`, in every
  `board_snapshot`, and its escalation chain keeps running. Its AckStore stamp survives a restart (the
  rehydrate-stale-ack risk noted 2026-10-25).
- **`/ingest` accepts identity resources from any feed for a `kabul` record.** Lane B's `_merge` now refuses a
  non-`kabul` write onto a `kabul` record (`98eb1b1`), but `/ingest` answers that refusal with the generic
  `{"identity": "stale"}` (`:767–768`), and a HIS feed could in principle post `meta.source = "kabul"` and write one.
- **X62 is still open:** the `/clinical` loop (`:671–707`) is inline; Lane B wants to chart from the admission form
  through the same code.

## 2. Decisions

| # | Decision | Why |
|---|---|---|
| D1 | **A discharge retires the patient from the alert world**, in one call: `retire_patient(engine, store, audit, hospital, patient_id, now)` in `api/alert_lifecycle.py`. It ends every alert of the patient — firing or latched — with an `alert_cleared` row whose reason is `"discharged"`, drops the patient's AckStore state (acks, first-seen, clocks, escalated, paged, latch, firing, remembered chains) and removes the engine's state (`Engine.forget`). Lane B's discharge path calls it once (`BoardLink.retire(hospital, patient_id)` → `app.state.retire_patient`), after the identity store's tombstone write. | Agreed with Lane B as A-11d. A skip in the escalation cycle alone would leave the pre-discharge alert active for ever (§1). Because B1a blocks discharge while a critical alert is open or latched, what gets retired is HIGH/MODERATE/LOW alerts and acknowledged criticals. |
| D2 | **The removal frame is published once, by app.py**, right after `retire_patient`: `retire_and_publish(hospital, patient_id, frame=None)` publishes `frame`, or the minimal removal `{"patient_id", "removed": true, "identity": null}` the retention sweep already sends (`app.py:358`). A dropped reading publishes nothing. | One place, after the alerts are ended, so no client sees an alert on a removed card. Lane B passes `_tombstone_board(record)` as `frame` once B1a is merged; the dashboard already applies `removed` frames (`dashboard/src/live/data/boardStore.js:102,180`). |
| D3 | **A reading for a tombstone is dropped before the engine**, at `/ingest` and `/clinical`: HTTP 200 `{"patient_id": id, "dropped": "discharged"}`, one audit row per observation — `event_type = "reading_dropped_discharged"`, `subject` = the signal code, payload `{"patient_id", "code"}`, no value — and nothing else: no engine call, no hook, no stamp, no frame, no notification. | The owner's decision. 200, not 4xx: the input is well-formed and the server chose not to apply it, as the identity path already answers 200 `{"identity": "stale"}`; a per-reading 4xx on a steady-state condition would show up as rejections in the hub's shadow and transport counters and in the forwarder's retries. The audit row is how the ward learns a monitor still carries a discharged number. |
| D4 | **What a tombstone is, on this branch:** `is_tombstone(record)` = the record exists, `state == "discharged"` and `source == "kabul"`, in `api/alert_lifecycle.py`, with `KABUL_SOURCE = "kabul"` beside it. | Lane B defines `patient_identity.KABUL` and `board._is_tombstone` on their branch; this branch is off `main` where neither exists. Same semantics, one file in Lane A's boundary; the merge unifies the constant (Lane A's follow-up after Lane B lands, O1). `patient_ids` on `main` still lists tombstones — the predicate is applied through `identities.get`, never through `patient_ids`, so Lane B's exclusion (`98eb1b1`) changes nothing here. |
| D5 | **`/ingest` refuses an identity resource whose source is `"kabul"`:** 400, `"identity source 'kabul' is reserved for the admission"`, before `identities.apply`. **An identity resource for an existing `kabul` record is refused as such:** 200 `{"patient_id", "identity": "refused", "reason": "kabul"}`, decided from `identities.get(...).source` before `apply`. Neither writes an audit row (today's `"stale"` writes none). | Agreed with Lane B (their item 2). Only the admission writes a `kabul` record; the HIS feed must not be able to create, revive or move one. With the refusal decided before `apply`, `_merge`'s `None` keeps meaning "older" on this path, and the "not yet measured" branch (`:773–778`) never publishes a card for a tombstone. |
| D6 | **The escalation cycle self-heals:** for each patient with a firing alert whose identity is a tombstone, the cycle runs `retire_and_publish` (audit rows, reason `"discharged"`, one removal frame) instead of escalating. | The guard for a crash between Lane B's tombstone write and the `retire` call. Checked only for patients with firing alerts, so the cost is one `identities.get` per alerting patient per cycle, not per bed. |
| D7 | **A restart retires too.** (a) `rehydrate` applies an `alert_cleared` row whose reason is `"discharged"` as the door did: `retire_state(engine, store, patient_id)` — the same ending without audit rows (the replay writes nothing, D7 of A1). Every other `alert_cleared` row stays ignored. (b) After the replay, `_ensure` sweeps the engine's patients once: a patient whose identity is a tombstone is retired the same way. | (a) keeps the replay self-contained and in id order. (b) covers a discharge whose audit rows were never written (the crash D6 guards against, or an audit failure after the in-memory retire) — the tombstone in the durable identity store is the fact of record. |
| D8 | **X62:** the `/clinical` loop becomes `chart_observations(engine, store, audit, notifier, hospital, charted, now, escalate_after) -> list[Alert]` in `api/clinical.py`: evaluation, hook, dedup re-arm, `chart` and `alert_cleared` rows, `alert` rows, first-seen stamps and their rows — exactly the lines `app.py:670–705`, unchanged in order. `/clinical` keeps parsing, the drop check (D3), the final `notifier.prune`, the frame and the answer. | Lane B charts the admission form's observations through the same code; a module-level function is importable, the closure is not. Pure extraction, pinned by the existing `/clinical` tests. |
| D9 | **Engine.forget(patient_id)** drops the patient's repository state (`PatientRepository.remove`), alerts, recognition anchor and dropped anchor, held NEWS2 alert, NEWS2 judge-at and profile. Idempotent; `patient_ids` no longer lists the patient. **AckStore.forget_patient(patient_id)** drops every entry of the patient in all eight structures. | The engine has no way to forget today (`pipeline.py:269–273`, `state/repository.py`). A profile is the admission's; a readmission is a new number and a new profile. |

## 3. Components

- `homunculus-engine/src/homunculus/state/repository.py` — `PatientRepository.remove(patient_id) -> None` on the protocol
  and `InMemoryPatientRepository`.
- `homunculus-engine/src/homunculus/pipeline.py` — `Engine.forget(patient_id)` (D9).
- `homunculus-engine/src/homunculus/api/ackstore.py` — `AckStore.forget_patient(patient_id)` (D9).
- `homunculus-engine/src/homunculus/api/alert_lifecycle.py` — `DISCHARGED = "discharged"` (a third `alert_cleared`
  reason), `READING_DROPPED = "reading_dropped_discharged"`, `KABUL_SOURCE`, `is_tombstone(record)`,
  `retire_state(engine, store, patient_id) -> list[Cleared]` (no audit; the replay and the sweep use it) and
  `retire_patient(engine, store, audit, hospital, patient_id, now) -> list[Cleared]` (the audit rows, through
  `Cleared.payload`). A `Cleared` for a latched alert carries the latch's first-seen, as `acknowledge_latched` does.
- `homunculus-engine/src/homunculus/api/rehydrate.py` — the `alert_cleared`/`"discharged"` branch (D7a).
- `homunculus-engine/src/homunculus/api/clinical.py` — `chart_observations(...)` (D8).
- `homunculus-engine/src/homunculus/api/app.py` — `/ingest` (D3, D5), `/clinical` (D3, D8), `_escalation_cycle` (D6),
  `_ensure` sweep (D7b), `retire_and_publish` + `app.state.retire_patient` (D1, D2). The one `identities.get` a
  reading already costs (`:814`) is read once at the top and reused for the frame.
- Docs: `homunculus-engine/README.md` (A-11 paragraph in the alert-episodes section), `docs/homunculus-rehber-TR.md`
  (taburcu edilen hasta: ölçüm düşer, uyarılar «taburcu» ile kapanır), the roadmap row G2-A11.

## 4. Data flow

**Discharge (Lane B → Lane A):** B1a confirms the discharge → identity store writes the tombstone → `BoardLink.retire`
→ `app.state.retire_patient(hospital, patient_id, frame)` → `retire_patient` (ends alerts, `alert_cleared` rows reason
`"discharged"`, store and engine forget) → `notifier.prune(hospital, live_keys(...))` → one removal frame → returns
the `Cleared` list.

**A reading after discharge:** `/ingest` → auth → parse → `record = identities.get(hospital, obs.patient_id)` →
`is_tombstone(record)` → audit `reading_dropped_discharged` → 200 `{"patient_id", "dropped": "discharged"}`. The same
at `/clinical` after `_require_patient` and `build_entries` (a malformed body is still 400): one row per entry, one
answer.

**An identity resource:** `/ingest` → parse → `incoming.source == "kabul"` → 400 · existing record is `kabul` → 200
`"refused"` · otherwise as today.

**The escalation cycle:** firing alerts are grouped by patient; a patient whose record is a tombstone goes through
`retire_and_publish` and is left out of `escalate(...)`.

**Restart:** `rehydrate` replays rows in id order; an `alert_cleared` with reason `"discharged"` retires the patient's
state at that point; after the replay `_ensure` retires every engine patient whose identity is a tombstone.

## 5. Errors and edge cases

- `retire_patient` on a patient the engine does not know: no rows, no error, the store entries (if any) are dropped.
- `retire_patient` while an alert is latched: the latch is ended with its own `Cleared` (reason `"discharged"`,
  first-seen from the latch). Lane B blocks the discharge in that case; the function still handles it.
- An audit failure inside `retire_patient` leaves the in-memory retire done (the alerts are gone from the board);
  the sweep (D7b) makes the restart agree with the tombstone.
- A reading whose patient has no identity record, or a HIS record, discharged or not: unchanged — today's path. Only a
  `kabul` tombstone drops readings; a HIS discharge keeps today's 24-hour card.
- A dropped reading is counted nowhere else: not in `/alarm-quality`, not in the shadow strip (which has its own door).
- `/scores/sofa/{id}` for a tombstone: `_score_state` answers an empty form from the identity (unchanged); Lane B's scope
  hides the patient. Out of scope here.

## 6. Tests

- `tests/test_engine_forget.py` — forget drops state, alerts, anchors, held alert, judge-at, profile; idempotent;
  `patient_ids` excludes it; a later reading starts a fresh state.
- `tests/test_alert_lifecycle.py` — `AckStore.forget_patient`; `retire_state` ends firing and latched alerts with
  `Cleared(..., DISCHARGED)`, first-seen carried; other patients untouched; `is_tombstone` truth table.
- `tests/test_api_discharge.py` — through `create_app` with an `InMemoryIdentityStore`: (1) a reading for a tombstone
  answers 200 `dropped`, one `reading_dropped_discharged` row with `subject` = code and payload `{patient_id, code}`,
  no engine state, no frame on `/stream`, no `alert` row; (2) the same at `/clinical`, one row per entry, a malformed
  body still 400; (3) `app.state.retire_patient` ends the alerts with `alert_cleared` rows reason `"discharged"`,
  publishes exactly one removal frame, `/alerts/{id}` answers 404 afterwards; (4) the escalation cycle retires an
  alerting tombstone instead of paging (no `escalation` row, one `alert_cleared` row, one frame); (5) `/ingest`
  identity: source `kabul` → 400; a HIS resource for a `kabul` record → 200 `refused`/`kabul`, the record unchanged;
  (6) a HIS-discharged patient's readings are still evaluated (the negative).
- `tests/test_rehydrate.py` — an `alert_cleared` row with reason `"discharged"` retires the patient on replay; the
  `_ensure` sweep retires an engine patient whose identity is a tombstone when no such row exists.
- `tests/test_api_clinical.py` — unchanged and green after the extraction (D8).

## 7. Out of scope

- Lane B's side: the tombstone write, `BoardLink.retire`/`is_discharged`, `_tombstone_board`, the test
  `test_a_reading_for_a_discharged_number_through_ingest_publishes_its_removal` (Lane A rewrites it as
  `..._is_dropped_before_the_engine` at the merge, O1), the discharge-blocked-by-critical rule.
- A2's VM deploy (owner's Q2/D6/D8 confirmation pending) and this slice's deploy: both after B1a decides the order.
- Scrubbing a tombstone's PHI (the owner decided a tombstone keeps the identity).

## 8. Open items

- **O1** At the merge with B1a: replace `KABUL_SOURCE`/`is_tombstone` with `patient_identity.KABUL`/`board._is_tombstone`
  (or move those two here), pass `_tombstone_board(record)` as the frame, rewrite Lane B's Task 5 `/ingest` test.
- **O2** `/alarm-quality` could count dropped readings per bed ("monitor still on a discharged number"); not asked for.
- **O3** The dropped-reading audit row carries no `obs_ts`; add it if the ward ever needs to know how long a monitor
  kept sending after discharge.

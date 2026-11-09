# Group 2 · Lane B · slice B1b — Transfer ("Nakil")

**Date** 2026-11-09
**Status** The owner's decisions of 2026-11-09 (§2) are binding. The same day the owner answered
the one open item, where the «Diğer» note is kept (D8). This text turns the decisions into a
design and awaits the owner's reading. **Plan:** not written yet.
**Lane** Lane B.
**Branches** this spec: `docs/g2b-b1b-b1c`, on `feat/g2b-b3a-doluluk` @ `c3965ed5`. The code goes
on `feat/g2b-b1b-nakil`, cut from main when the plan is written, after B3a is on main.
**Migration** `0018`, shared with B1c (D8, §5.9): whichever of the two slices is built first
writes all of it.
**Builds on**
- B1a — `docs/superpowers/specs/2026-10-25-g2b-kabul-taburcu-design.md`: unit scope, the Taburcu
  tab, `BedPicker`, the discharge's board step and its retry.
- A-37 — `docs/superpowers/plans/2026-10-25-g2b-kabul-taburcu-amendments.md`: why transfer is
  closed (C-1, C-2, A-35(a)) and what reopens it.
- O8 — `docs/superpowers/specs/2026-11-02-g2b-o8-nakil-protokol-design.md` (`b19d654c`): the
  protocol moves to the arriving row.
- B3a — `docs/superpowers/specs/2026-10-26-g2b-doluluk-design.md`: `RESERVED`,
  `confirm_reserved`, `bed_reserved`, `_free_guards`. Its R5 hands the reserved-bed rule for
  transfer to this slice.

**Prototype** `tasarim-taslaklari/app/admin.js` `transferModal` (≈ lines 574–620) on
`origin/tasarim/prototip`: "Şu an: <yatak>", the reason list, a bed picker that opens on the
current unit, "Transfer et". Use it for its visual language only.
**Companion** B1c (`2026-11-09-g2b-b1c-bakim-ekibi-design.md`): the care team a transfer carries.

## 0. Where the code stands (`feat/g2b-b3a-doluluk` @ `c3965ed5`)

Paths are relative to `homunculus-engine/src/homunculus/`.

| # | Fact | Where |
|---|---|---|
| F1 | Both transfer routes answer 409 `transfer_unavailable` after their permission and tenant checks, and write nothing. The comment above them lists A-37's reopening conditions. | `admission/router.py:896-957` |
| F2 | `initiate_transfer` reads the target with an unlocked `db.get` and never reads `target_unit_id`. `confirm_transfer_arrival` writes the body's `target_unit_id`, unchecked, as the new row's `admitting_unit_id`. | `admission/service.py:292-401` |
| F3 | The arrival closes the source as TRANSFERRED and sends its bed to HOUSEKEEPING. It moves the protocol (O8: the source is set to NULL and flushed first). It creates an ACTIVE row with `source_admission_id` and `transfer_confirm_deadline`; nothing reads the deadline. It sets the target OCCUPIED. | same |
| F4 | The arrival copies the active care-team rows but never closes the source's. It omits `identity_digest` and B1a's form fields: `admission_type`, `blood_group`, `allergies_text`, `no_known_allergy`, `comorbidity_codes`, `comorbidities_text`. | same |
| F5 | Neither machine has a direct step. An admission goes ACTIVE → PENDING_TRANSFER → TRANSFERRED. A bed goes OCCUPIED → PENDING_TRANSFER_OUT → HOUSEKEEPING. | `admission/models.py:54-72`; `tenant/models.py:64-73` |
| F6 | A card made here sits on its record's own `bed_id` and `unit_id`. `put_identity` refuses a discharged number, writes the record, drops the strip's occupant cache and republishes. The strip links a monitor to whoever's record names its bed. `device_beds` belongs to the bed, so no device row changes. | `admission/boardlink.py:129-140, 242-252`; `api/board.py:309-316`; `api/app.py:1529-1551` |
| F7 | **Gap.** The stream sends a frame only to screens whose scope holds the frame's bed or unit (`api/app.py:1753`). A moved card names the new place, so a screen scoped to the old unit alone keeps the card it had. A removal for an old place already exists in kind: `tombstone_board` (`api/board.py:319-323`). | |
| F8 | `_last_card_off` reads DISCHARGED admissions only. A TRANSFERRED row is skipped, so a card that failed to move would stand on a freed bed: C-1 again. | `tenant/router.py:578-618` |
| F9 | `_locked(db, admission, *also)` locks every bed in id order, then the admission, read afresh. It was kept for this slice. | `admission/router.py:695-722` |
| F10 | B3a (`801ac4c5`) admits into a RESERVED bed only with `confirm_reserved: true`. Without it the refusal is 409 `bed_reserved`, naming the bed id only. Every bed transition clears `state_reason` and `state_note`. B3a's out-of-service note is optional, ≤ 200, and required for the reason OTHER (X3). | `admission/router.py:506-508`; `admission/schemas.py:210`; `tenant/models.py:199-212`; `tenant/router.py:821-823` |
| F11 | `_open_critical` counts the board's unacknowledged critical alerts for a key. The discharge refuses on it. | `admission/router.py:739-750` |
| F12 | `admissions.move.initiate` is held by `attending` and `unit_physician`; `admissions.transfer.confirm` by `nurse` and `charge_nurse`; `hospital_admin` holds all keys by rule. `require_permission(a, b)` passes a holder of either. | `auth/permissions.py` `DEFAULT_GROUPS`; `auth/dependencies.py:166` |

## 1. What this slice delivers

An authorised clinician moves a lying-in patient to another bed in one action. The patient keeps
her protocol number, her card, her alerts and her care team. The old bed goes to cleaning. The move
refuses what C-1 and C-2 allowed.

## 2. Decisions (the owner's, 2026-11-09)

| # | Decision | Why |
|---|---|---|
| D1 | **One step.** One action moves the patient. The old bed goes to HOUSEKEEPING and the new bed becomes OCCUPIED. | The ward moves the patient, then records it. A pending middle state has nobody to confirm it. |
| D2 | **The protocol stays** (O8). | A transfer happens inside one visit. The label, the devices and the card keep one number. |
| D3 | **The board card and the monitor link follow** to the new bed. | C-1: a card left on the old bed broke the monitor link and let two cards stand on one bed. |
| D4 | **A reason from a list:** Klinik ihtiyaç / Yoğun bakıma / Yoğun bakımdan servise / İzolasyon / Hasta veya yakın isteği / Diğer, with a note for Diğer. The reason is written to the audit row. D8 adds where the reason and the note are kept. | An inspection asks why a patient moved. The list is the prototype's. |
| D5 | **Who:** a physician holding `admissions.move.initiate`, or a nurse or charge nurse holding `admissions.transfer.confirm`. | Either may be the one who moves the patient at night. |
| D6 | **Reach both beds.** The caller's units must hold the source bed and the target bed. | Closes C-2: a physician of one unit could move another unit's patient. |
| D7 | **An unacknowledged critical alarm warns; it never blocks.** | A patient often moves because she is deteriorating. Her alerts move with her, under the same board key. |
| D8 | **The reason and the note are kept on the arriving admission** (the owner, 2026-11-09, answering open item O-1). `transfer_reason` is text, checked against the six reasons. `transfer_note` is `EncryptedString`, ≤ 200 characters of plaintext. Both columns go into migration `0018`, which also serves B1c: whichever slice is built first writes it whole, with `down_revision = "0017"`. The audit row carries the reason and `note: true/false`, never the text. «Diğer» requires a note, as B3a's X3. | The audit is PHI-free by design (`admission/trail.py:10-11`), and B3a R8 keeps free text out of it because a note may name a person. Encrypted at rest, the note is kept like `beds.state_note`. One migration for two slices keeps one chain. |

## 3. Derived in this spec

| # | Rule | Why |
|---|---|---|
| T1 | **One route, `POST /admissions/{admission_id}/transfer`, replaces both closed routes.** `/transfer/initiate`, `/transfer/confirm`, `TransferInitiate`, `service.initiate_transfer` and the code `transfer_unavailable` (with its four texts) are removed. | D1 leaves nothing to initiate or confirm. No client calls the old routes (A-37). |
| T2 | **The body names the bed only.** The unit is read from the bed (`Bed → Room.unit_id`). `target_unit_id` is gone. | A-37's condition: the unit is the bed's real one, never the body's (A-12). |
| T3 | **The state machines stay as they are.** Inside the one transaction the source walks ACTIVE → PENDING_TRANSFER → TRANSFERRED, and its bed OCCUPIED → PENDING_TRANSFER_OUT → HOUSEKEEPING (F5). No pending state is ever committed. | No enum or transition changes, and each state keeps one meaning. |
| T4 | **Only an ACTIVE admission moves.** A DRAFT is signed first. A patient whose discharge has started is not moved. Both get 409 `invalid_transition`. | A DRAFT has no attending, and the arriving row is ACTIVE. No route cancels a started discharge. |
| T5 | **The target** is open (bed, room and unit) and AVAILABLE, or RESERVED with `confirm_reserved: true` (B3a R5). Every other state is refused. | B3a's admission rule, applied to the same bed. |
| T6 | **The arriving row is the source, whole**, plus `identity_digest`, plus the move's own `transfer_reason` and `transfer_note` (D8). `admission_datetime` is the transfer time; the stay's start is reached through `source_admission_id`. `transfer_confirm_deadline` stays NULL. | F4. A-37: one open admission per person. S-27's deadline has no reader and is not this slice. |
| T7 | **The care team moves.** The source's active rows are closed (`is_active` false, `closed_at` set) and copied, active, onto the arriving row. | F4. An open row on a closed admission would point the own-patient scope at the H-number, not at the card's key. |
| T8 | **The card moves after the commit, old place first.** A removal frame for the old bed and unit goes out, then the card at the new place. | F7. A screen of the old unit is told. A screen of both units applies the removal, then the card; frames keep their order. |
| T9 | **A card that did not move is moved again, never taken off.** The same request retries it. Releasing the old bed retries it too, or refuses `board_not_cleared`. | The discharge's pattern (A-35, I-2). This card belongs to a patient who is still admitted. |

## 4. Screen

- **Kabul › «Taburcu» becomes «Nakil / Taburcu»**: az «Köçürmə / Evə yazılma», ru «Перевод /
  Выписка», en «Transfer / Discharge». The tab also opens for `admissions.move.initiate` and
  `admissions.transfer.confirm`. Their holders hold `admissions.view` today; the tab's list states
  the keys anyway.
- **«Nakil»** sits on each ACTIVE row of the lying-in list, for a holder of either permission.
  A DRAFT row and a started discharge get no «Nakil».
- **The dialog «Nakil · <yatak · oda · birim>»:**
  - "Şu an: <yatak · oda · birim>. Eski yatak temizliğe geçer."
  - **Neden:** a select of the six reasons (D4), and a note box (≤ 200, with a counter) under it.
    The note is optional, except for «Diğer», which requires it (D8), as B3a's out-of-service
    dialog does (X3).
  - **Yeni yatak:** `BedPicker`, opened on the patient's current unit. The current bed is shown
    and not offered. A RESERVED bed is offered with its note (from `GET /tenant/occupancy`) and
    B3a's question. Choosing it sends `confirm_reserved: true`.
  - **The warning.** When the board shows this patient a critical alarm nobody acknowledged:
    «Bu hastada onaylanmamış kritik alarm var. Nakil engellenmez; alarmlar hastayla birlikte yeni
    yatağa geçer.» It uses the warning tone and holds nothing. Before the board has loaded it says
    nothing: it is a hint, not a hold.
  - «Vazgeç» · «Nakil et». The button is held while the write and the re-read after it are in
    flight (A-17).
- **After the move:** a toast "<eski yatak> → <yeni yatak>; <eski yatak> temizliğe alındı". The
  list is read again.
- **`board: failed`:** a note that stays, «Kart yeni yatağa taşınamadı», with «Kartı yeniden
  taşı». The button sends the same request again (§5.5). The note goes when the retry lands.
- **Refusals** are read as words: `bed_reserved` (the question is asked again),
  `bed_not_available`, `bed_closed`, `out_of_scope`, `invalid_transition`, `field_invalid:note`.
  `transfer_unavailable` leaves `apiErrors.js` and `kabul.js`.
- The screen supports four languages (az by default), the Gece and Gün themes, 390 px and 1440 px,
  keyboard and screen reader. The az, ru and en texts are the planner's and await a native
  reading, as every `kabul` text does (O48).
- A bed is named "label · room · unit". No UUID, no raw key, and no patient name on the toast.

## 5. Backend

### 5.1 The route

`POST /admissions/{admission_id}/transfer`, guarded by
`require_permission("admissions.move.initiate", "admissions.transfer.confirm")` and
`caller_tenant_id`. It gets one row in the route-permission table.

Body `TransferRequest` (`extra="forbid"`):
- `target_bed_id: UUID`;
- `reason: TransferReason`: `CLINICAL_NEED`, `TO_ICU`, `ICU_TO_WARD`, `ISOLATION`,
  `PATIENT_OR_FAMILY_REQUEST`, `OTHER`;
- `note: str | None`: stripped, blank read as none, ≤ 200 characters. Optional with any reason,
  required with `OTHER` (422 `field_invalid:note`), as B3a's X3;
- `confirm_reserved: StrictBool = False`, as B3a's admission.

Answer `TransferResponse` (201): the arriving admission (`AdmissionResponse`), `board` (`ok` |
`failed`) and `critical_alarm_open` (bool).

### 5.2 Order of checks

1. The admission and the target bed are the caller's tenant's. Another tenant's is the 404 a
   missing one is.
2. `_reach_admission` on the source bed: 403 `out_of_scope`.
3. The target's unit is read from the database (`Bed → Room.unit_id`), then
   `unitscope.require_reach` on it: 403 `out_of_scope` (D6).
4. The note rules: 422, before any lock.
5. `_locked(db, admission, target_bed_id)`: both beds in id order, then the admission, read
   afresh.
6. A TRANSFERRED source whose arriving row is open on `target_bed_id` is a retry (§5.5).
7. The source must be ACTIVE: 409 `invalid_transition` (T4). The target must not be the source's
   bed: 422 `field_invalid:target_bed_id`.
8. The target bed, its room and its unit are open: 409 `bed_closed`. A RESERVED target without
   `confirm_reserved`: 409 `bed_reserved`, carrying `bed_id` only and never the note. Any state
   other than AVAILABLE or RESERVED: 409 `bed_not_available`.

A transfer takes the same locks as an admission into the target bed, a reservation of it, a
second transfer of the patient and a discharge start. One runs after the other, and the second
meets the first's result and is refused by state.

### 5.3 The write

`service.transfer_patient` replaces `confirm_transfer_arrival`. In one transaction:
1. The source walks ACTIVE → PENDING_TRANSFER → TRANSFERRED; its bed walks OCCUPIED →
   PENDING_TRANSFER_OUT → HOUSEKEEPING (T3).
2. The source's `protocol_no` is set to NULL (O8), and its active care-team rows are closed (T7).
   **Flush.** The source leaves `uq_admissions_tenant_protocol` and `uq_admissions_open_identity`
   before the insert.
3. The arriving row is inserted. It carries every note field of the source, B1a's form fields,
   `identity_digest`, `protocol_no`, `attending_physician_id`, `signed_by` and `signed_at`. It is
   ACTIVE, on the target bed, with `admitting_unit_id` the target's real unit,
   `admission_datetime` now, `source_admission_id` the source, and `transfer_confirm_deadline`
   NULL. It also carries the move's `transfer_reason` and, when written, its `transfer_note`
   (encrypted; D8, §5.9). These two are the move's, not the stay's: a later transfer of the same
   patient writes its own on its own arriving row, and copies neither.
4. The target goes AVAILABLE or RESERVED → OCCUPIED. The transition clears a reservation's note
   (F10).
5. The source's closed care-team rows are copied, active, onto the arriving row, with the same
   role, window and `granted_by_id`.

The critical count is read under the locks (`_open_critical`), for the answer and the audit row.
It refuses nothing (D7).

### 5.4 After the commit

1. The audit row (§5.6). It never raises (A-26).
2. `BoardLink.move(hospital, record, left=(old bed_id, old unit_id))`, a new method. `record` is
   `kabul_record` for the new place, stamped now and built from values taken before the commit, as
   `_to_board` builds its card. The method:
   - refuses a discharged number, as `put_identity` does;
   - writes the record to the identity store and drops the strip's occupant cache. The target
     bed's monitor now links the patient, and the old bed's monitor links nobody;
   - publishes the removal for the old place, `{"patient_id": key, "removed": true, "identity":
     {"bed_id": old, "unit_id": old_unit}}` (the shape of `tombstone_board`), then the card at
     the new place;
   - answers `ok` or `failed` and never raises, as `take_off` does.

The board key does not change. The engine's alerts, acknowledgements, escalations, charted weight
and comorbidity profile stay with the patient.

### 5.5 The retry, and the release

- **Retry.** The same request, on a TRANSFERRED source whose arriving row is open on the body's
  bed, writes nothing in the database. It runs `BoardLink.move` again (idempotent) and answers
  the arriving row with its `board`. The checks of §5.2 steps 1–5 apply. It is audited
  `admission.transfer_board_retry` with `via: "transfer"`.
- **Release.** `_last_card_off` (`tenant/router.py`) also reads the bed's TRANSFERRED admissions.
  For each, it follows `source_admission_id` forward to the patient's open admission, if one
  exists. If her card still names this bed, it runs `BoardLink.move` to that admission's place,
  audited `admission.transfer_board_retry` with the caller's `via` (`bed.release`,
  `bed.transition` or `bed.return_to_service`). If the move fails, the bed is refused 409
  `board_not_cleared` with the patient number and the board key. A card already elsewhere, or a
  tombstone, is passed over. It never takes a card off (A-37, O8).

### 5.6 Audit

`admission.transfer`, with `patient_id` the board key. Its payload:
- `source_admission_id`, `admission_id` (the arriving row);
- `from_bed_id`, `from_unit_id`, `to_bed_id`, `to_unit_id`;
- `protocol_no`: the moved number (O8);
- `reason`, and `note: true|false`;
- `bed_was_reserved: true`, only when it was (B3a X9);
- `critical_alarm_open: true|false`;
- `care_team_moved`: the number of rows copied;
- `actor`.

Never a name, and never the note's text. The audit is PHI-free by design (`admission/trail.py`),
and B3a R8 keeps free text out of it. The text is kept encrypted on the arriving row (D8).

### 5.7 Errors

| Code | When |
|---|---|
| 403 `out_of_scope` | The source bed or the target bed is outside the caller's units. |
| 404 | The admission or the bed is another tenant's, or missing. |
| 409 `invalid_transition` | The source is not ACTIVE, and the request is not a retry. |
| 409 `bed_closed` | The target bed, its room or its unit is closed. |
| 409 `bed_reserved` + `bed_id` | The target is RESERVED and `confirm_reserved` is not true. |
| 409 `bed_not_available` | The target is occupied, in cleaning, in maintenance, out of service or pending. |
| 422 `field_invalid:note` | The note is missing for OTHER, or longer than 200. |
| 422 `field_invalid:target_bed_id` | The target is the patient's own bed. |
| 409 `board_not_cleared` | On a release: a moved card could not be moved to its bed. |

Removed: `transfer_unavailable`.

### 5.8 Catalogue and leftovers

- The two permissions keep their keys. Their texts change in `auth/permissions.py` and in
  `perms.js`, in four languages: `admissions.move.initiate` "Nakil yapar ya da taburcu başlatır";
  `admissions.transfer.confirm` "Hastayı başka yatağa nakleder". No group gains or loses a key.
- Admissions in PENDING_TRANSFER and beds in PENDING_TRANSFER_OUT are not expected: no client ever
  called the old routes. The plan's deploy block counts them and reports any it finds. They are
  not migrated.

### 5.9 Migration `0018` (shared with B1c, D8)

One migration serves B1b and B1c: `0018`, `down_revision = "0017"` (G3-02's `0017_tasks`).
Whichever slice is built first writes it whole, with both slices' parts. The other slice then
finds its part done. B1c's spec (§5.1) lists the care-team steps; B1b's part is:
- `admissions.transfer_reason`: VARCHAR, NULL, with the check `ck_admissions_transfer_reason`
  (NULL or one of the six `TransferReason` values). A seventh reason is a migration, as B3a's
  `ck_beds_state_reason` is.
- `admissions.transfer_note`: `EncryptedString(PHI_COLUMN_LENGTH)`, NULL. It holds ≤ 200
  characters of plaintext (the request's bound); the column's width is the ciphertext's
  (`admission/models.py` `PHI_COLUMN_LENGTH`).
- Both are NULL on every existing row, and on every row not written by a transfer.
- The downgrade drops both.

`AdmissionResponse` gains `transfer_reason`. No route returns the note in this slice (§7).

## 6. Tests

Backend:
- **Transitions.** An ACTIVE patient moves. The source becomes TRANSFERRED and its bed
  HOUSEKEEPING. The target becomes OCCUPIED, from AVAILABLE and from RESERVED with confirmation.
  No pending state is committed.
- **Refusals.** Each source state: DRAFT, PENDING_DISCHARGE, DISCHARGED, and TRANSFERRED without
  its arriving row on that bed. Each target state: OCCUPIED, HOUSEKEEPING, MAINTENANCE, BLOCKED,
  the pending states, and RESERVED without confirmation. A closed bed, room or unit. The patient's
  own bed. Each note rule. Every refusal writes nothing.
- **The arriving row.** The moved protocol (synthetic `202600000001`), the source's NULL, and the
  same board key. `identity_digest` is carried: a new admission of the same person after the move
  is refused `duplicate_open_admission`. B1a's fields are copied. `admitting_unit_id` comes from the
  bed; a body carrying `target_unit_id` is a 422.
- **The care team.** The source's rows are closed; the arriving row's are active, with their
  roles and windows.
- **Scope and tenant isolation (C-2).** A caller holding only the source unit, only the target
  unit, or both; an administrator; each permission alone; neither (403). Another tenant's admission
  or bed is a 404.
- **Concurrency.** A transfer racing an admission into the same bed, a reservation of it, a second
  transfer of the same patient, and a discharge start. Exactly one winner each; the loser is
  refused by state.
- **Board.** The card sits at the new bed and unit under the same key. The removal for the old
  place precedes the card. A stream scoped to the old unit gets the removal only; one scoped to the
  new unit gets the card only; one scoped to both gets the two, in that order. The strip's occupant
  cache is reset. The alerts stay under the key.
- **Critical alarm (D7).** With one open, the move succeeds, and `critical_alarm_open: true` is in
  the answer and in the audit row.
- **Board failure.** `board: failed` is answered. The retry moves the card. Releasing the old bed
  moves it, or refuses `board_not_cleared`. Nothing takes the card off.
- **The reason and the note (D8).** The arriving row holds the reason, and the note encrypted at
  rest (the raw column is not the plaintext). A note with any reason is kept; OTHER without one is
  a 422. A second transfer writes its own reason and copies neither. Migration `0018`: the check
  refuses a seventh reason; the downgrade drops both columns.
- **Audit without PHI.** `admission.transfer` carries the moved protocol, the reason and
  `note: true`. It carries no name and no note text.
- **The old routes are gone** (404/405). The route-permission table and `test_tenant_isolation.py`
  follow the new route.

Dashboard:
- «Nakil» is gated by either permission and absent on DRAFT and started-discharge rows.
- The tab's new name, the six reasons and the dialog, in four languages. The note is optional,
  and required for Diğer.
- The reserved-bed question. The warning is shown and the button is not held.
- The `board: failed` note and its retry.
- No UUID on screen. `transfer_unavailable` is no longer mapped.

## 7. Not in this slice

- «Nakil» from an occupied Doluluk tile (B3a's screen). It comes later, on this route.
- Correcting a DRAFT's bed (a wrong-bed admission).
- Moving a patient whose discharge has started. No route cancels a discharge.
- The receiving attending's confirmation within an hour (S-27). `transfer_confirm_deadline` stays
  NULL.
- Assigning a nurse at the new bed. `POST /shift-schedule` has no reader.
- Reporting the move to the HIS.
- Removing `PENDING_TRANSFER` and `PENDING_TRANSFER_OUT` from the enums, which needs a migration.
- A move to another hospital. That is a discharge to another institution (B1a D7).
- Showing a move's reason and note on a screen (a stay's history). The columns are written now
  (D8); a later screen reads them.

## 8. Open for the owner

None. The one open item, where the «Diğer» note is kept, was answered on 2026-11-09 and is D8.

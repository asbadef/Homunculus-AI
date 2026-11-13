# G3-07 · Kabul zamanı — the admission form records when the stay began — design

**Date:** 2026-11-12 · **Branch:** `feat/g3-kabul-zamani` (from main `88f6544c`) · **Migration:** none
(`admissions.admission_datetime` exists, NOT NULL, `admission/models.py:282`) · **Permissions:** none new (the holders of
`admissions.admit`, as today) · **Routes:** none new
**Status:** the owner's design, approved 2026-11-12 (§2 D1–D9; «6 saat», «yalnız kabulde»). The number G3-07 is free on
the roadmap (controller lane, 2026-11-12). Two points the owner left to the spec are decided here and marked *(spec)*:
the refusal code of the bed and person bounds (§3.2) and the place of each new check in the route (§3.1).
**The owner approved this written spec («İkisine de evet», 2026-11-12).** Implementation plan next. Every file:line
below was read at `88f6544c`.

## 1. Why

On a ward a patient is measured on arrival, often before the kabul form is saved: the nurse takes the round, then fills
the form. Homunculus records the stay as beginning when the form is saved.

What main does today:

- **The form never sends a time.** `dashboard/src/live/screens/kabul/admitForm.js` `toBody` (129–154) builds `note`
  without `admission_datetime`. B1a copied the prototype's field list (its spec §5.2 names no time); no spec decided to
  leave the time out.
- **The server already takes one.** `AdmissionNoteFields.admission_datetime` is optional (`admission/schemas.py:163`,
  «defaults to now»); `service.create_draft_admission` stamps `_now()` when it is None (`admission/service.py:138–139`).
  `form.check_admission` refuses a time without its zone and one more than `CLOCK_SLACK` (2 min) ahead
  (`admission/form.py:55`, `:112–116`). **Nothing bounds it below**: a direct API call can open a stay in 1990 today.
- **Since G3-05 the start decides what can be linked.** A set measured before the target's stay began, less
  `BEDSIDE_SKEW` (2 min), is refused 409 `reading_before_stay` (`api/readings.py:148–157`, `:732–733`). The stay start
  is the first row's `admission_datetime`, walked back along transfers (`api/tasks_postgres.py:33–44`
  `STAY_WALK_BACK`/`ADMITTED_AT`; `api/readings_postgres.py:193–201` `stay_start`). So a round measured on the device
  before the form was saved and listed in «Eşleşmeyen ölçümler» — typed under another number, since the protocol does
  not exist until the save — can never be linked to the patient it belongs to. (A round typed with the right protocol
  after the save reaches the record already: the door stamps the admission by key at arrival, with no time check,
  `api/app.py:1636–1642` `_admission_for`.)
- **The guide says so** (`docs/homunculus-rehber-TR.md` 2821–2829: «kabul formunda kabul saati girilecek bir alan
  yoktur, yatış kabulün kaydedildiği an başlar»). Its workaround: chart the values by hand at their time, reject the set.

This slice lets the form say when the stay began, inside bounds that keep two stays from overlapping.

## 2. Decisions

| # | Decision | Why |
|---|---|---|
| D1 | **A «Kabul zamanı» field, first in the form's «Kabul» box** (`AdmitTab.jsx` 549–604). It shows the current minute. **Untouched, nothing is sent** and the server stamps the save, as today. **Touched, the chosen minute goes out as ISO UTC.** The minute is kept in the session's draft form (`admitDraft.js`), and the string is derived from it the same way on every send, so every send of that form carries the same string (§5). Input bounds: min = max(now − 6 h, the chosen bed's «free since», `state_since`), max = now + 1 min (§5: the 6-hour side kept a minute inside, as the bedside form keeps its 24 hours). | The bedside form's X12 rule (G3-01, `bedside/vitalsFields.js:84–112`): an untouched time is the server's clock. Untouched, the body is the one the form sent before, so the A-19 digest (`_request_digest`, `admission/router.py:172–183`, the whole note) stays stable across resends. A touched time is part of the form like any field: a resend under the same id with another time, after the first send landed, is `request_conflict` (A-19, unchanged). |
| D2 | **Server bounds (owner: «6 saat»).** Today's checks stay where they are: zone-aware, ≤ now + `CLOCK_SLACK` (`form.py:112–116`, run at `router.py:508`). New: `at < now − BACKDATE_MAX` (6 h) → 422 `field_invalid:admission_datetime`. The new bound and those of D3 and D4 run **after** the `_earlier` look-up (`router.py:514–517`), as the attending check does (`:518–524`). | Six hours covers a patient measured on arrival and admitted after the paperwork; a slipped day or month is refused. After the look-up, so a resend whose answer was lost is answered with the admission it made, never refused because the clock moved on (§3.1). The two checks that stay before the look-up cannot change on a resend: the zone is the body's, and a time not ahead of the clock at the first send is not ahead later. |
| D3 | **Not before the bed was free.** Under the bed lock (`_bed_of`, `router.py:191–203`), when the form sent a time and the bed is AVAILABLE or RESERVED: `at < bed.state_updated_at` (when the bed's current state began, `tenant/models.py:170–172`, stamped by every `transition_to`, `:199–208`) → **409 `admitted_before_bed_free`** *(spec, §3.2)*. A bed in any other state is left to the service's `bed_not_available`, as today. | Two stays in one bed never overlap: a stay back-dated into the previous occupant's time, or into the cleaning, would claim her readings. It keeps G3-05's guard «a discharged patient's round cannot be linked to the next patient in that bed» (final review I-1): her rounds were measured while she lay there, before the release, so before any start this bound allows. |
| D4 | **Not before the same person's last discharge.** When the form sent a time and has an `identity_digest` (A-37; every form has one, the birth date being required, `schemas.py:126`): the newest `discharge_at` of the tenant's DISCHARGED admissions with that digest; `at <` it → **409 `admitted_before_discharge`** *(spec, §3.2)*. Rows without a digest (written before 0012) are not checked; a DISCHARGED row without `discharge_at` is not either (`max` skips it). | One person's two stays never overlap. The stay-start readers (G3-05's link guard, the vital task) would otherwise give the new stay readings of the old one. `discharge_at` is the discharge's recorded time (set when the discharge starts, `service.py:538`); the row keeps no time of the confirm (O4). |
| D5 | **Not editable later (owner: «yalnız kabulde»).** No new route, no PATCH. The time is set by the kabul or not at all. | Readings linked and tasks anchored by the start would be judged by one start and kept under another. |
| D6 | **Audit.** The `admission.admit` payload (`router.py:597–601`) gains `admission_datetime` (ISO, always: the row's own) and `backdated: true` only when the form sent a time — as `bed_was_reserved` is written only when true. The row's own `ts` stays the save's. | The trail shows when the stay was said to begin and that a person said it; the save time is already the row's. |
| D7 | **Transfers unchanged.** An arriving row is stamped now (B1b T6, `service.py:442`, `:459–463`; `admission_datetime` is in `_OWN_TO_EACH_ROW`, `:360–367`). The stay start stays the first row, walked back: `transfer.stay_began` (`transfer.py:114–131`), `tasks_postgres.ADMITTED_AT`/`MOST_MOVES`, G3-05's `stay_start`. Doluluk's tile and the bed card keep showing the bed's state time, the save (open item O1). | B1b's record of a move is the move. A back-dated kabul moves the start of the whole stay because every reader walks back to the first row. |
| D8 | **The effects of an earlier start are stated, not engineered** (§4): G3-05's window, visibility and reconcile stamp; the vital task's fallback anchor; the discharge's lower bound; SOFA's `admitted_at` (always None today); the card's identity stamp stays now. | Every one of them reads `admission_datetime` already. Only the dashboard's structure index needs a change to know the bed's time (§5). |
| D9 | **The next-protocol typo guard of G3-05 is weakened inside the back-dated window, and only there: the accepted trade-off** (§4.1). | Protocols are sequential, so a round typed with the next number is often a neighbour's (G3-05 final review I-1). Back-dating moves the new patient's start earlier, so such a round measured in the window becomes hers to link and leaves the other ward's view. At most 6 h, and only when the nurse back-dates. |

## 3. Server

### 3.1 The order of the checks in `create_admission` *(spec)*

`router.py:459–618`. Steps marked **new** run only when the form sent `admission_datetime`; with none sent, the route
behaves exactly as today.

1. `form.check_admission` (`:508`), unchanged: zone and the 2-minute future bound stay here (D2).
2. `_bed_of` (`:509`): the bed row locked FOR NO KEY UPDATE and read afresh; the unit (`:510–511`); the caller's
   scope (`:512–513`).
3. `_earlier` (`:514–517`): a form sent before under this `request_id` is answered with its admission (A-19).
4. The attending is a physician (`:522–524`), 422.
5. **new** `form.check_admission_time(at, now=now)`: 422 `field_invalid:admission_datetime` when
   `at < now − BACKDATE_MAX`. `now` is the route's (`:495`). *(As built, final review: the same step goes on with
   `form.check_admission_not_before_birth` — the same 422 when the DATE of `at` in the hospital's zone is more than a day
   (`BIRTH_SLACK`) before the patient's date of birth; §11.)*
6. One open admission per person (`:525–527`), 409 `duplicate_open_admission`.
7. `bed_closed` (`:528–529`); `bed_reserved` without the confirmation (`:534–536`).
8. **new** The bed bound (D3): only for a bed AVAILABLE or RESERVED; a RESERVED bed reaches this step only with
   `confirm_reserved`.
9. **new** The person bound (D4): `_last_discharge_of(db, tenant_id, identity)`, one
   `select max(discharge_at)` over `admissions` where `tenant_id`, `identity_digest` and `state = DISCHARGED`.
10. The protocol and the H-number (`:540–541`): nothing is spent on a refusal above, as for every refusal since B1d.

**Why 5, 8 and 9 come after 3.** A resend of a form that was admitted, its answer lost:

- the 6-hour bound can turn false as the clock moves on: a time 5 h 50 min back, resent 15 minutes later;
- the bed is OCCUPIED since the first send, its state time that send's save, so a bed bound read first would refuse
  the form's own admission;
- the person's admission is the open one.

Read before the look-up, each would refuse a form that has already admitted. After it, the resend is answered with its
admission (A-19), as the attending check has been since G2-B1c.

**Why 5 sits among the 422s and 8, 9 among the 409s.** A value wrong on its own is said before the state of the
ward: the attending, then the time's 6 hours. The person's open admission (6) is said before her last discharge (9),
which concerns closed stays only. A closed or reserved bed (7) is said before the bed's time (8). Beds in other states
skip 8 and are refused `bed_not_available` by the service (`service.py:121–126`), as today: comparing against the time
an OCCUPIED bed became occupied would misname the refusal.

The bed lock makes 8 race-free: a release or a reservation of that bed waits for this transaction. Step 9 reads without
a lock. The person's previous admission is DISCHARGED only through PENDING_DISCHARGE, whose start wrote `discharge_at`
(`service.py:538`). While it is open, step 6 refuses, and the open-identity index refuses at the flush
(`models.py:384–387`). Step 9 has no index of its own: it runs only when a time is sent, over one tenant's admissions
(thousands a year).

### 3.2 The refusal codes of D3 and D4 *(spec)*

**Choice: two coded 409s,** a G3-07 block in `admission/errors.py` after G4-04's (`:82–85`), widening `CODES` the same
way:

```python
# G3-07 — Kabul zamanı (spec D3, D4). Its own block after G4-04's, which it widens the same way.
ADMITTED_BEFORE_BED_FREE = "admitted_before_bed_free"    # the time is before the bed's current free state began
ADMITTED_BEFORE_DISCHARGE = "admitted_before_discharge"  # the time is before this person's last discharge
CODES = CODES | frozenset({ADMITTED_BEFORE_BED_FREE, ADMITTED_BEFORE_DISCHARGE})
```

Words: «The admission time is before the bed became free.» / «The admission time is before this person's last
discharge.» Neither refusal carries an extra key: no time, number or bed. The screen reads the structure again, which
holds the bed's `state_since` (§5). The person's last discharge belongs to another stay, possibly another unit's, so it
is stated and never shown, as A-37's refusal states an open admission and names its number only within scope.

Why not 422 `field_invalid:admission_datetime`:

1. **A 422 `field_invalid` is a value wrong on its own**: `form.py`'s rules, judged from the body and the clock. The
   bed and the person bounds are the ward's state when the send arrives. The bed may have been released or reserved
   after the form read the structure, and the form never sees the person's last discharge. Refusals of that kind are
   409s already: `bed_not_available`, `duplicate_open_admission`.
2. **The dashboard maps a code, never words** (`errors.py:4–10`; `apiErrors.js:201–206`). One `field_invalid` code
   carries one sentence. The nurse needs three: too old, before the bed was free, before the person's discharge. Each
   tells her something different to change. Two codes give each bound its own sentence in four languages, and
   `apiErrors.test.js`, which reads `errors.CODES`, fails while either is unmapped.

The 6-hour bound stays 422 `field_invalid:admission_datetime` (owner D2): it is a rule on the value and the clock alone,
the family of the future bound beside it.

### 3.3 The audit row (D6)

`router.py:597–601` becomes:

```python
payload={"admission_id": str(admission_id), "bed_id": str(card["bed_id"]),
         "unit_id": str(card["unit_id"]), "actor": actor,
         "protocol_no": protocol_no, "patient_number": number,
         "admission_datetime": written.admission_datetime.isoformat(),
         **({"backdated": True} if sent_at is not None else {}),
         **({"bed_was_reserved": True} if was_reserved else {})}
```

`written` is the `AdmissionResponse` taken before the commit (`:587`); `sent_at` is `payload.note.admission_datetime`.
`backdated` means "the form sent a time". A nurse who touches the field and leaves the current minute is recorded as
having set it.

### 3.4 Engine files

- `admission/form.py`: `BACKDATE_MAX = timedelta(hours=6)`; `check_admission_time(at, *, now)` (None passes; `now`
  zone-aware, as `_server_clock` requires). `check_admission` is unchanged.
- `admission/errors.py`: the block above.
- `admission/router.py`: steps 5, 8 and 9 of §3.1; `_last_discharge_of`; the payload of §3.3; the route's docstring
  gains a paragraph on the time.
- `admission/models.py`: comment-only. `:342–345` says the `identity_digest` is NULL on «a transfer's arrival». Since
  B1b T6 the arriving row carries the source's digest (`service.py:401–402`, the digest is not in `_OWN_TO_EACH_ROW`).
  D4 relies on that: the last row of a moved stay is the one that gets DISCHARGED.
- Unchanged: `schemas.py` (the field exists), `service.py` (it keeps a sent time, `:138–139`), `transfer.py`, every
  store in `api/`.

## 4. What an earlier start changes (D8, D9)

None of this needs code. Each reader takes the column as it is; the plan pins each one with a test (§6).

### 4.1 G3-05: the link window, visibility, reconcile

A back-dated kabul moves the G3-05 window back with it:

- **`stay_start`** (`readings_postgres.py:197–201` → `ADMITTED_AT`, `tasks_postgres.py:43–44`) answers the back-dated
  first row's time. For a stay moved since, the walk back (`STAY_WALK_BACK`, `:33–39`) reaches that same row.
  `open_stays` (`:203–209`, the backfill's bound) walks back the same way.
- **`open_admissions`** (`readings_postgres.py:211–214`; `OPEN_ADMISSIONS`, `api/admission_keys.py:21–22`) answers the
  open ROW's time. For a stay no move has touched, that is the back-dated time. For a moved stay it is the move, as
  today (T6).
- **The link.** `before_stay` (`readings.py:148–157`) refuses a set only when it was measured before (back-dated start
  − `BEDSIDE_SKEW`). Example: saved at 14:00 with «Kabul zamanı» 11:30. A set measured 11:29 links; one measured 11:27
  is refused `reading_before_stay`. The 24-hour bound (`READING_TOO_OLD`, `:727–728`) is unchanged.
- **Visibility** (`_reading_visibility`, `app.py:1696–1735`). A set under the patient's own number, measured from
  (back-dated start − 2 min), is visible only where the caller's scope reaches the patient. Before this slice, a set
  measured more than 2 minutes before the save was «before the stay» and therefore everybody's. Sets under any other number are judged by
  that number, as today.
- **Reconcile's stamp** (`reconcile` → `stay_of`, `readings.py:969–979`). A row reconcile files for a reading measured
  at or after the open row's start gets the admission. With the start back-dated, readings measured in the window are
  stamped; today they are filed with none. Reconcile allows no 2-minute tolerance, as today. The door's own stamp
  (`_admission_for`) reads no time and is unchanged.

**The trade-off (D9).** Consider ward P's round, typed with the next protocol number before that number was issued,
and measured inside patient Q's back-dated window. Since G3-05 I-1 such a round was everybody's and could not be linked
to Q. Now it can be linked to Q, and only Q's scope sees it, so P's ward no longer does. Outside the window, and for
every kabul not back-dated, the guard holds as before. What remains against such a link: the identity question before
it (G3-05 D11: «Soyad ad ve doğum yılı hastayla eşleşiyor mu?»), the name the device shows, «Düzelt», and Q's ward's
«Reddet».

### 4.2 The others

- **The vital task** (G3-02). Its fallback anchor, used when no measurement falls in the last 48 h (`tasks.py:503`,
  `vital_task` `:203–225`), is `admitted_at` (`tasks_postgres.py:142–151`, the same walk): the back-dated start. Due =
  start + the band's interval. With `BACKDATE_MAX` 6 h and b0's default of 720 min (`tasks.py:113`), the task falls due
  at least 6 h after the save, so nothing reads «gecikti» at the kabul. A hospital that sets b0 shorter (Yönetim ›
  Görevler) can see the task due at once. That is accurate: nothing has been recorded since the stay began. A linked
  arrival set anchors it.
- **The discharge's lower bound** follows the start. The server's is `transfer.stay_began`, the first row
  (`router.py:1382–1388`; `form.py:161–162`). The dialog's is `row.admission_datetime` for a row no move
  opened (`DischargeDialog.jsx:85–87`). An earlier start allows earlier discharge times and refuses none that are
  allowed today.
- **SOFA.** `sofa_form.build(admitted_at=getattr(record, "admitted_at", None))` (`app.py:2650–2654`, `:2689`) reads an
  attribute `IdentityRecord` does not have (`api/patient_identity.py:84–109`): it is always None. Nothing changes; note
  only.
- **The card's identity stamp stays now.** `card_record` stamps `datetime.now` (`boardlink.py:154–164`), and the
  identity store orders its writes by it (`kabul_record`'s docstring, `:142–145`). The H-number's year
  (`next_patient_number(now=now)`, `router.py:541`) and the protocol belong to the save as well.
- **Unchanged by construction.** The DRAFT 2-hour reminder reads `created_at` (`service.py:180–194`).
  `NEWEST_FIRST` and `OPEN_ADMISSIONS` order by `admission_datetime` (`admission_keys.py:15`, `:21–22`), but two open
  rows share a key only for legacy H-numbers: a new admission has its own protocol (`PROTOCOL_INDEX`, unique). The
  Kalite indicators read no admission time (`quality/router.py:64–68`).
- **Doluluk and the bed card** show the bed's `state_since`, OCCUPIED since the save (`DolulukScreen.jsx:265`). Not
  changed (O1).

## 5. Dashboard

- **`data/structure.js` `indexStructure`** (35–39) keeps `stateSince: bed.state_since ?? null`: the server's string as
  written, never parsed and rebuilt. Today the index drops it. The engine sends it on every bed (`tenant/router.py:460–461`,
  `tenant/schemas.py:139–140`).
- **`screens/kabul/admitForm.js`.**
  - `emptyForm()` gains `admittedAt: ""` (the `datetime-local` text) and `admittedAtTouched: false`, so «Yeni kabul»
    (`freshForm`) clears them.
  - New: `BACKDATE_MS` (6 h), and `admittedBounds(nowMs, freeSince)` → `{ minMs, maxMs }`:
    - the 6-hour side is kept a minute inside and rounded up to a whole minute, as `vitalsFields.oldestInput` keeps
      its 24 hours (`:19–29`), so the browser is the stricter one;
    - the bed side is the minute that holds `freeSince`;
    - `maxMs` = now + `SKEW_MS` (1 min).
  - New: `admittedAtOf(form, freeSince)`, the string sent or null. Null when untouched. A minute that holds the bed's
    `state_since` sends that string exactly as the server wrote it. That is `DischargeDialog`'s A-34 I-1 rule
    (`DischargeDialog.jsx:8–17`, `:71–76`): the minute's start would fall before the microseconds the server keeps.
    Any other minute goes out as `new Date(fromLocalInput(text)).toISOString()`. The text is read with
    `DischargeDialog`'s `fromLocalInput` (`:45–56`), which builds the date from its parts and refuses 30 February.
    The same text and the same bed give the same string on every send, so the A-19 digest holds.
  - `missing(form, today, { now, freeSince })` names `admittedAt` (`kabul.miss.admittedAt`) when it is touched and
    unreadable, or outside the bounds. «Kabul et» stays held, as for every gap.
  - `toBody(form, requestId, { confirmReserved, freeSince })` adds `note.admission_datetime` only when
    `admittedAtOf` gives a string.
- **`screens/kabul/AdmitTab.jsx`.**
  - The field comes first in the «Kabul» box: `Field` with `kabul.f.admittedAt` holding
    `Input type="datetime-local"`, with `min`/`max` from `admittedBounds`.
  - Untouched, it displays `localInput` of the current minute. The clock is the server-corrected one
    (`useBoardNow`, `screens/common/BoardState.jsx:390–394`), re-read every 30 s, as the bedside form judges its time
    by the server's clock. The plan checks that the Kabul screen sits under the shell's `BoardProvider`; if it does
    not, the browser clock is used, as `localToday` (`:80–83`) is today.
  - Hint: `kabul.admittedAtHint`, and `kabul.admittedAtBedSince` once a bed is chosen (the time from `stateSince`).
  - `freeSince` comes from `index.beds.get(normId(form.bedId))?.stateSince`.
  - In `failed()` (`:368–439`), `field_invalid:admission_datetime`, `admitted_before_bed_free` and
    `admitted_before_discharge` are said on the toast after the bed, as every refusal is. The structure is read again
    (the bed's new `state_since` moves the min) and `tried` is set. Focus moves to the field, but only from where a
    press leaves it (`focusIsIdle`, `:110–113`). Nothing is held: the nurse changes the time and sends again.
- **`apiErrors.js`** `ADMISSION_CODE_KEYS` (206–259) gains `admitted_before_bed_free` →
  `kabul.err.admittedBeforeBedFree` and `admitted_before_discharge` → `kabul.err.admittedBeforeDischarge`.
  `field_invalid:admission_datetime` keeps its key (`:326`).
- **`i18n/strings/kabul.js`**, in tr, az, ru and en. The Turkish source is below; the other three are written by the
  implementer and wait for a native reader (O5).
  - `f.admittedAt`: «Kabul zamanı».
  - `admittedAtHint`: «Değiştirilmezse kaydın anı yazılır. En çok 6 saat geriye.»
  - `admittedAtBedSince`: «Yatağın boşaldığı ya da rezerve edildiği an: {time} — kabul zamanı bundan önce olamaz.»
    (As built: the first draft's «Yatak {time}'den beri boş: …» put a fixed suffix on a time that Turkish inflects —
    «11:30'dan», «23:00'ten» — and said «boş» of a reserved bed, whose time is the reservation's start; §11.)
  - `miss.admittedAt`: «Kabul zamanı: en çok 6 saat geriye, yatağın boşaldığı andan önce ve gelecekte olamaz.»
    (As built: «gelecekte olamaz» in place of the first draft's «ileri bir saat olamaz», and likewise in az and en;
    §11.)
  - `invalid.admissionDatetime`, widened from «… (gelecekte olamaz).» (tr `:204`, az `:392`, ru `:580`, en `:768`):
    «Kabul zamanı geçerli değil (gelecekte ya da 6 saatten eski olamaz).» (As built: «… (gelecekte, 6 saatten eski ya da
    doğum tarihinden önceki bir günde olamaz).» — the birth-date guard of §11 answers the same code.)
  - `err.admittedBeforeBedFree`: «Kabul zamanı, yatağın boşaldığı andan önce olamaz.»
  - `err.admittedBeforeDischarge`: «Kabul zamanı, bu hastanın son taburcusundan önce olamaz.»
- **Denetim: no change.** The page shows no payload (`DenetimScreen.jsx:10`). It reads only the actor keys
  (`denetim.js:31–49`), and `actor` is unchanged. `EVENT_TYPES` is unchanged (no new type).

## 6. Testing

**Engine** (tests first):

- `tests/test_admission_form.py`:
  - `check_admission_time`: exactly now − 6 h passes, 1 µs older is 422 `field_invalid:admission_datetime`, None
    passes, a naive `now` is the named ValueError;
  - `BACKDATE_MAX == timedelta(hours=6)` pinned;
  - the existing future-bound cases (`:108–109`, `:576`) stay on `check_admission`, unchanged.
- New `tests/test_admission_time.py` (Postgres, `kabul_world`'s ward):
  - **untouched**: no field; the row's time is the save; the payload's `admission_datetime` equals the row's and there
    is no `backdated`;
  - **2 h back**: 201; the row and the answer carry it; the payload has `backdated: true`; the card identity's
    `updated_at` is the save;
  - **6 h**: 5 h 59 min accepted; 6 h 1 min is 422; nothing is spent (the protocol counter and the H-number stay, as
    B3a's test pins for `bed_reserved`);
  - **the bed** (D3):
    - a bed released at T: a time before T is 409 `admitted_before_bed_free`, a time at or after T is 201;
    - a RESERVED bed with `confirm_reserved` is bound by the reservation's start;
    - an OCCUPIED bed with a time is `bed_not_available`, never the bed bound;
  - **the person** (D4):
    - a person discharged with `discharge_at` D, readmitted to another bed: a time before D is 409
      `admitted_before_discharge`, a time at or after D is 201;
    - a moved-then-discharged stay binds by its last row;
    - another person's discharge binds nothing;
    - a legacy row without a digest binds nothing;
  - **resend after the window**: a first send 5 h 59 min back admits; with the route's `_now` moved 10 min on, the
    same form is answered 200 with the same admission (no 422, and no bed bound although the bed is OCCUPIED); another
    form under the id is `request_conflict`, as before;
  - **order**:
    - a non-physician attending plus a 7-hour-old time gives `field_invalid:attending_physician_id`;
    - a person with an open admission plus a time before her last discharge gives `duplicate_open_admission`;
    - a closed bed plus a time before its release gives `bed_closed`.
- **Audit payload pins** that change (controller lane's list, checked): `tests/test_admission_api.py:100–103` and
  `tests/test_protocol_admission.py:144–146` compare the whole payload dict and gain `admission_datetime`. Unchanged:
  `test_reserved_admission.py:94–95`, `:103–104` (key checks); `test_care_team_sign_off.py:129` and
  `test_protocol_admission.py:101` (absence); `test_discharge_api.py:953` (types); `test_admission_trail.py` (the
  trail's log line). There are no other readers of the payload: the engine's one writer is `router.py:597` and no
  module reads it back; the dashboard shows no payload (§5).
- **Stay-start readers on Postgres**, one admission back-dated 2 h:
  - `PostgresReadingStore.stay_start`, `open_stays`, `open_admissions` and `PostgresTaskStore.admitted_at` answer the
    back-dated time;
  - after a transfer, `stay_start` and `admitted_at` still answer it, and `open_admissions` answers the move;
  - `transfer.stay_began` answers it, and a discharge time between the back-dated start and the save is accepted;
  - `reconcile` stamps a reading measured in the window with the admission.
- **End to end** (Postgres; the ward of `kabul_world` with a `PostgresReadingStore` on the same database and the policy
  `unmatched`):
  - two device sets go to `/ingest` under a number nobody holds and are listed «unknown»: set A measured 1 h before the
    save, set B measured 7 h before it;
  - the kabul is saved with «Kabul zamanı» 2 h before the save;
  - set A links to the new protocol: 200, no `reading_before_stay`, filed with the admission at its own time;
  - set B is refused 409 `reading_before_stay`;
  - the control: the same set A against an untouched kabul is refused `reading_before_stay`.
- **Pins that stay**: `test_route_permissions.py` `EXPECTED`, `test_board_permissions.py` `BOARD_EXPECTED`,
  `test_tenant_isolation.py`, `test_permissions.py` `SPEC_KEYS`, `denetim.js` `EVENT_TYPES`, nginx `API_PATHS` (no
  route, no permission, no event type). `errors.CODES` grows by two.

**Dashboard:**

- `admitForm.test.js`:
  - the exact `body.note` (`:104–108`) stays as it is for an untouched form: no key;
  - touched, `admission_datetime` is the minute in ISO UTC, and two `toBody` calls of one form give the same string;
  - a minute that holds `freeSince` sends `freeSince` as written;
  - `missing` names `admittedAt` past either bound and when ahead, and never when untouched.
- `AdmitTab.test.jsx`:
  - the body (`:214`): untouched sends no `admission_datetime`, touched sends it;
  - a send with no answer, then a resend: the same `request_id` and the same `admission_datetime` string;
  - the field's `min`/`max`; choosing a bed moves `min` to its `state_since`;
  - each of the three refusals: toast, a re-read and the focus.
- `kabul.testutil.js`: `bed()` (`:35`) takes a `state_since`.
- `structure.test.js`: `stateSince` kept.
- `apiErrors.test.js`: the two codes (it reads `errors.CODES`).
- Also: strings in four languages (key parity), the raw-key sweep, 390 and 1440 px, two themes.

**Gates:** engine no-DB pytest; the Postgres subset (admission, transfer, readings, tasks); dashboard vitest;
`vite build`.

**Local walk** (synthetic only: «Test Hasta»; local stack; ORU from `scripts/hl7_simulator.py` over MLLP):

1. A set under a typo number, measured 1 h ago, is listed. Admit with «Kabul zamanı» 90 min ago, link the set: it
   shows in «Ölçüm kaydı» at its own time, and Görevlerim anchors on it.
2. A set measured 7 h ago, under the same typo: the link is refused (`reading_before_stay`, with its sentence).
3. A bed released 30 min ago: the field's min is the release, and an earlier time sent through the API answers 409
   `admitted_before_bed_free` with its sentence.
4. Discharge a patient, then readmit her to another bed with a time before that discharge: 409
   `admitted_before_discharge`.
5. An untouched form: the row's time is the save; Denetim lists the kabul as before.

## 7. Docs

- **The guide**, `docs/homunculus-rehber-TR.md`. Content as follows; the implementer writes the final wording.
  - §3.8, the form's list (1175–1176). *Kabul* begins: «kabul zamanı (değiştirilmezse kaydın anı; hasta daha önce
    geldiyse geldiği dakikaya çekilir — en çok 6 saat geriye, yatağın boşaldığı andan ve hastanın son taburcusundan
    önce olamaz; kaydedildikten sonra değiştirilemez), kabul türü\*, …». One more line: «Temizlik bitti · boş» is
    pressed when the cleaning ends, because the bed's free time is the earliest kabul time it allows.
  - §3.27, «Yatıştan önce ölçülen set» (2826–2829) is replaced by: «Ölçüm gerçekten o hastanınsa — hasta ölçüldükten
    sonra kabul edildiyse — kabul formunda «Kabul zamanı» hastanın geldiği dakikaya çekilir (en çok 6 saat geriye;
    yatağın boşaldığı andan ve hastanın son taburcusundan önce olamaz). Yatış o andan başlar ve o andan (2 dakika
    payıyla) sonra ölçülen set bağlanabilir. Kabul kaydedildikten sonra kabul zamanı değiştirilemez; o durumda ya da
    6 saatten eski bir ölçümde değerler hasta ekranındaki «Ölçüm gir» ile ölçüm saatine elle girilir (en çok 24 saat
    geriye; kaynağı «elle» olur) ve set gerekçesiyle reddedilir.» One more sentence: a set measured in the window under
    the patient's own number is seen only by those who see the patient (D9).
  - §3.16, 1911 («dayanak kabul zamanıdır») stays true. It gains «(formda girilen kabul zamanı)».
- **The roadmap** (`docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md`) gains a G3-07 row when
  the slice is built.

## 8. Deploy

Main and the VM are the owner's word, through Lane A, which writes the blocks. What they must say:

- **Images: api + web.** No migration, no environment variable. **Order: api first, then web.** The new api answers
  the old form as today, because no time is sent. A new form on the old api would send times that the old api takes
  with no lower bound.
- **Rollback: web first, then api.** Back-dated rows stay back-dated. Under the old images they read the same way,
  because every reader takes the column. The old api has no lower bound, but no screen of the old web sends a time.
- **The ward is told:** the field and its six hours; that it is set at the kabul or never; that «Temizlik bitti · boş»
  is pressed when the cleaning ends, because a bed released late caps the time.
- **Check after the start:** a web asset grep finds the new key (`admittedBeforeBedFree`); an untouched kabul on the
  VM writes an `admission.admit` row whose payload has `admission_datetime` and no `backdated`.

## 9. Not in this slice

- **Changing the time after the kabul** (D5): no route, no screen.
- **Back-dating a transfer's arrival**: an arriving row is the move's record (B1b T6, D7).
- **Doluluk's tile and the bed card showing the stay's start** in place of the bed's state time (O1).
- **A stay start for HIS-fed patients**: they have no kabul row; G3-05's guard leaves them alone (`before_stay`
  with `began` None).

## 10. Open items

- **O1.** Doluluk's tile and the bed card show the save, not the stay's start. A later slice decides whether they show
  the start.
- **O2.** The bed bound reads the release, not when the bed was physically free. A bed released late (the nurse
  presses «Temizlik bitti · boş» just before the kabul) caps back-dating at the release. The guide and the ward note
  say to release when the cleaning ends.
- **O3.** For a RESERVED bed the bound is the reservation's start, which is later than the bed's release and so
  stricter. Accepted: a reservation is made for a patient who has not arrived yet.
- **O4.** The person bound reads `discharge_at`, the discharge's recorded time chosen when it starts, not the moment
  the charge nurse confirmed the departure. The row keeps no confirm time (only the audit row does). A patient
  readmitted between those two moments passes the bound. The open-identity index still refuses two open stays.
- **O5.** The az/ru/en strings wait for a native reader (as G3-05 O4).
- **O6.** The stale comment `admission/models.py:342–345` is fixed in this slice, comment-only (§3.4).

## 11. As built

Plan: `docs/superpowers/plans/2026-11-12-g3-kabul-zamani.md`. Built on `feat/g3-kabul-zamani`; code head `3fa46665`
(the docs commit follows it; the final review's polish, `f274d9d4` and `48ab42de`, follows that — see «Final review
polish» below); gates run 2026-11-13 (the lines are in the plan's «As run» block). No migration (alembic head `0021`),
no environment variable, no route, no permission, no event type.

**Commits by task** (after the plan, `0993360c`):

| Task | Commit(s) |
|---|---|
| E1 — `BACKDATE_MAX`, `check_admission_time` | `6eef4d7e` |
| E2 — the two codes, mapped and worded | `e9758e73` |
| W1 — `stateSince` in the structure index | `30897311` |
| W2 — the form's rules | `c2229143`; review `1494480d` (the free minute inclusive; «gelecekte olamaz») |
| E3 — the route's bounds and the audit row | `4a167831`; review minors `3fa46665` |
| E4 — the stay-start readers, end to end | `f687dadd` |
| W3 — the field on the Kabul tab | `02f096b1`; review `0391536a` (M-1, M-2, M-3) |
| D1 — the guide, the roadmap row, this section | `1397d8a8` |
| Final review polish — the dashboard (hint wording, the refusal's scope) | `f274d9d4` |
| Final review polish — the engine's birth-date guard, the 422's widened words | `48ab42de` |
| Final review polish — the guide, this section, the plan's «As run» | `c6567f32` |
| The birth-date guard allows a day's margin (a tenant zone never blocks a newborn) | the commit after `c6567f32` |

What differs from the design above (the plan's departures, E-1 … E-7, and the reviews):

- **§3.3.** The audit row's `admission_datetime` is written in UTC (`astimezone(timezone.utc).isoformat()`): the row's
  own instant, one spelling, whatever offset the form sent (E-1). Pinned by a test that sends `+04:00` and reads
  `…+00:00` (`3fa46665`); the reserved-bed test now names its refusal, `admitted_before_bed_free`, not only the 409.
- **D3.** A bed whose `state_updated_at` is NULL (the column is nullable since 0001) binds nothing (E-2).
- **§6.** The end-to-end test builds `vital_readings` from migration 0021's own `upgrade()` on the models' schema,
  without the `audit` index; `kabul_world.ward_app`/`ward_client` pass `**extra` to `create_app` (E-3). The new test
  file's beds are free since a day unless a test sets their time (E-4).
- **§5, the hint.** The hint's time is `dayStamp` (`11:30`, or `11.11 23:00` on another day) (E-5). `admitForm.js`
  imports `DischargeDialog`'s `fromLocalInput`; the bedside picker imports `admitForm.js`, so the bedside page loads
  that 4 kB chunk and `PrintLabelButton` became its own: precache 73 → 74 (E-6). A resend near the six-hour edge is
  handled by the form's existing look-up (E-7).
- **§5, the wording.** `miss.admittedAt` reads «… ve gelecekte olamaz» in place of §5's first draft «… ve ileri bir saat
  olamaz»; az «… və gələcəkdə ola bilməz» (was «irəli vaxt»), en «… and not in the future» (was «not ahead»); ru
  already said «не в будущем». One word for the future side across the form, as `invalid.admissionDatetime` says
  «gelecekte» (W2 review, `1494480d`). §5 above and the plan carry the new wording.
- **§5, the field after review** (`0391536a`). Cleared and left (blur with an empty value), the field is untouched
  again: it shows the current minute and sends nothing (M-1; on blur, never on a change, since Chrome reports a
  half-typed time as an empty value while she types). A server refusal of the time — `admitted_before_discharge`, or
  a six-hour refusal only the server saw — keeps the refused text in the form (`admittedAtRefused`, in `emptyForm`,
  never sent) and the field says the server's sentence under it (`aria-invalid`) until the nurse changes the time; a
  time she chose while the refused send was out is not marked (M-2). Tests pin a bed with a later free time and a
  clock tick past a typed time (the panel names it, «Kabul et» is held) and the draft across a tab remount (M-3).

**Final review polish** (`f274d9d4` dashboard; `48ab42de` engine and the 422's words; the guide):

1. **The bed hint has no suffix and does not say «boş» of a reserved bed.** tr «Yatağın boşaldığı ya da rezerve edildiği
   an: {time} — kabul zamanı bundan önce olamaz.»; az, ru, en say the same without a suffix. The first draft's
   «Yatak {time}'den beri boş» fixed a suffix that Turkish inflects with the time («11:30'dan», «23:00'ten», and
   `dayStamp`'s «11.11 23:00») and called a RESERVED bed free, whose time is the reservation's start (O3).
2. **The server's words under the field stand only for what the server judged** (`AdmitTab.jsx` `refusalStands`). The
   refused record keeps, beside the time, the bed id and the name and birth date of the send. `admitted_before_bed_free`
   stands while the form holds that bed — another bed, free earlier, clears it; `admitted_before_discharge` while the
   name (as `sameName` reads it) and the birth date are the same — another bed leaves it, another name or birth date
   clears it; `field_invalid:admission_datetime` while the birth date is the same. The same bed again brings them
   back. Tests for each.
3. A comment in `AdmitTab.jsx` that wrapped mid-sentence is re-set.
4. **The guide** (§3.8, §3.27) says what the bound is on each path: the «Temizlik bitti · boş» press for a bed that was
   cleaned; the reservation's start for a reserved bed; the moment of the un-reserve or the return to service for a bed
   that went that way; the form's hint shows the real time.
5. **A time more than a day before the birth is refused** (the NICU). `form.check_admission_not_before_birth(
   admitted_on, born=)`: 422 `field_invalid:admission_datetime` when the DATE of the time sent, in the hospital's own
   zone, is more than `BIRTH_SLACK` (a day, the birth date's own margin) before the date of birth; the birth day and the
   day before it pass, and a form that sent no time is not asked. The route runs it right after
   `check_admission_time`, so also after the look-up of an earlier send, and reads the date with
   `hospital_today(zone, sent_at)` — the mechanism of the birth date's own `today` (A-10). **The margin is there so no
   tenant zone can block a newborn:** `Tenant.timezone` is «UTC» until set and unchecked when written (A-16), and a
   strict date test would refuse a child born at 00:30 local and admitted at 00:40 under a «UTC» tenant. The guard
   still catches a gross back-dating error (two days or more before the birth). Tests: the rule (no database,
   `test_admission_form.py`: the edge, the day after, two days before) and the route (`test_admission_time.py`,
   Asia/Baku by a stand-in zone database as `test_admission_api.py` does: the birth day and the day before pass under a
   Baku tenant and under a UTC tenant; a time two days before the birth is refused). The dashboard's words for the code
   widen in four languages: tr «Kabul zamanı geçerli değil (gelecekte, 6 saatten eski ya da doğum tarihinden önceki bir
   günde olamaz).» The form does not bound the field by the birth date: the server's refusal is said under the field
   (item 2). *(First built without the margin — a strict date test, `48ab42de` — and loosened by the commit after
   `c6567f32`.)*

The open item of §5 is settled: the Kabul screen is under the shell's `BoardProvider` (`LiveApp.jsx` wraps every phase
in it), so the field's clock is `useBoardNow`, the server-corrected one.

**Pins.** `errors.CODES` 34 → **36** (engine, `test_admission_form.py`, `apiErrors.test.js`), `ADMISSION_CODE_KEYS` 36;
`EXPECTED`, `BOARD_EXPECTED`, `SPEC_KEYS`, `UNSCOPED_BY_DESIGN`, nginx `API_PATHS`, `EVENT_TYPES` unchanged; alembic
head `0021`; precache 73 → **74** entries (1646.16 KiB; `KabulScreen-*.js` 37.25 kB).

**Gates** (2026-11-13, code head `3fa46665`):

- Engine, no database, three chunks: `test_[a-d]*` 1373 passed / 848 skipped; `test_[e-l]*` 1720 / 114;
  `test_[m-z]*` + `rules`, `scoring`, `tenant` 1382 / 586 — **4475 passed, 1548 skipped**, no failure. Against the
  plan's 4488 / 1547: the 13 fewer passed are the 13 tests of `test_infinity_vm_pilot.py`, which the plan's
  `--ignore` did not exclude (its glob names the file) and which this run left out of the file list; the one more
  skipped is the new database test of `test_admission_time.py`.
- Postgres (`kabulz-pg`): `test_admission_time.py` 21 passed; `test_admission_api.py` + `test_admission_form.py` 202
  passed, 1 skipped; `test_protocol_admission.py` + `test_reserved_admission.py` + `test_admission_trail.py` +
  `test_care_team_sign_off.py` 31; `test_discharge_api.py` + `test_transfer_api.py` + `test_transfer_model.py` 105;
  `test_readings_api.py` 111; `test_readings_postgres.py` + `test_tasks_postgres.py` 66;
  `test_migration_0021_vital_readings.py` 5 — **541 passed, 1 skipped**.
- `alembic heads`: `0021 (head)`. Python 3.14, the slice's no-database files: 157 passed, 21 skipped.
- Dashboard: **178 files, 4789 tests** passed (the plan's 4780, +1 of the W2 review, +8 of the W3 review).
- `vite build`: `precache 74 entries (1646.16 KiB)`; no «larger than 500 kB» line.

**Gates of the final review polish** (2026-11-13, head `48ab42de`; the selections the polish touches, not a whole
suite): dashboard `src/live/screens/kabul` + `src/live/i18n` 26 files, **522 passed** (`AdmitTab.test.jsx`,
`admitForm.test.js`, `admitDraft.test.jsx`, `apiErrors.test.js`, `strings.test.js` alone: 442 — the polish adds 4 tests
to `AdmitTab.test.jsx`); engine, no database, `test_admission_form.py` **154 passed** (+2); Postgres (`kabulz-pg`, stopped
after) `test_admission_time.py` **24 passed** (+3), `test_admission_api.py -k "date or time or newborn or hospital"` 5
passed, 1 skipped. After the margin (the commit after `c6567f32`): `test_admission_form.py` 154 passed,
`test_admission_time.py` **26 passed** (the birth test now has five cases), dashboard `src/live/screens/kabul` 14 files,
**416 passed**. A whole-suite run, and the build's precache line, are the controller's.

**Open, for the owner:**

1. **The bed bound is when the bed's current state began** (`state_updated_at`). A reservation made and lifted, or a
   reservation made after the patient arrived, moves it later, and the patient cannot be back-dated to her real
   arrival: the bed's earlier free time is not stored.
2. **A late «Temizlik bitti · boş» caps the back-dating** at the press (O2). The guide and the ward note say to press
   it when the cleaning ends.
3. **For a RESERVED bed the bound is the reservation's start** (O3).
4. **The person bound reads `discharge_at`**, not the moment the charge nurse confirmed the departure (O4).
5. **A transfer's arrival time is not back-datable** (§9, D7); Doluluk's tile and the bed card show the save, not the
   stay's start (O1).
6. **The az/ru/en strings await a native reader** (O5).
7. **The birth-date guard has a day's margin, so no admission can be blocked by the tenant's time zone** (`Tenant.timezone`
   is «UTC» until set; the walk's seeded tenant is still «UTC»). It refuses only a time more than a day before the date
   of birth, so it catches errors of more than a day and nothing finer; a time up to a day before the birth is accepted
   whatever the zone. An untouched field sends no time and is never asked.
8. **A device set under the patient's OWN number, measured before the back-dated stay began, is recorded on the stay**
   (walk O-1; below). Only the link checks the stay's start; ingest under a live number checks none (G3-05's door,
   unchanged here).

**Deploy, for the controller lane** (full notes at the end of the plan): api + web only, **api first**; no migration,
no environment variable; rollback web first. The ward is told beforehand of the field, its six hours, that it is set at
the kabul or never, and that «Temizlik bitti · boş» is pressed when the cleaning ends.

**Local walk (§6, Task G2), 2026-11-13.** Record: `/c/tmp/homunculus-plans/g3-kabul/walk/notes.md` (outside the
repository, with the screenshots). Run on code head `1397d8a8` (images built from it; the worktree clean before and
after), in a separate compose project `g3kabul` (containers `g3kwalk-*`, web `127.0.0.1:18206`, alembic `0021`), on
synthetic data only (tenant `kabul-yuruyus`, «Test Hasta …», the typo number `202600000010`, device `CONNEX-3A`), the
dashboard driven headless in Turkish at 1440 and 390 px. **All five items and 390 px PASS; no finding for G3-07.** The
polish above came after the walk and is pinned by tests, not walked.

| Item | What the walk saw |
|---|---|
| 1 untouched | The emptied field, left, shows the current minute and no mark; «Kabul et» sent no `admission_datetime`; 201; the row's time is the save's (0.7 ms before `created_at`); the audit row carries `admission_datetime` and no `backdated`. |
| 2 two hours back | `min` six hours inside, `max` a minute ahead; 09:15 sent as `…T05:15:00.000Z`, 201; the row's time 09:15, the audit row `backdated: true`; the vital task's `anchor_at` is that time (Görevlerim). |
| 3 seven hours back | A time under `min` is named by the panel, «Kabul et» `aria-disabled`, pressed anyway 0 POSTs; the API at 7 h back: 422 `field_invalid:admission_datetime`, no row, no number spent; the forced on-screen 422 says the sentence under the field and on the toast. |
| 4 bed and discharge | After «Temizlik bitti · boş» the field's `min` is the release; a time a minute before it, 409 `admitted_before_bed_free` (the API, and on screen from a stale structure, where the refusal re-read the hint to the new time); readmitting a discharged person before her discharge, 409 `admitted_before_discharge`, then 201 a minute after it; refusals spent no protocol number. |
| 5 device sets | Sets under the typo number, 1 h and 7 h back, land `unmatched`; linking the 1 h set to the back-dated stay: 200, the record shows it at its own time; the 7 h set: 409 `reading_before_stay`, still listed. |
| 390 px | The field is 259 px wide, the hint wraps under it, no horizontal scroll, light and dark; the refusal state and toast fit. |

*Adaptations (not findings).* No bridge: the device sets were posted to `/ingest` with the tenant token (as the previous
walk). Beds 1 and 3 were moved a day back (`state_updated_at`), because a bed counts as free since its creation: before
that, bed 1 read «Yatak 11:12'den beri boş» with `min` 11:12, so a kabul two hours back was not possible on a bed made
two minutes earlier — the bound at work. The on-screen 422 and one refusal at 390 px were forced (the POST body rewritten
in flight); the natural bed refusal used a stale structure (a reservation made and cancelled through the API moved the
bed's time on). A refused send keeps the form (the session draft): the next patient typed into it inherited the refused,
touched time until the field was emptied and left (M-1).

*Observations (not G3-07 defects).* **O-1** a set under the patient's own number, measured before the back-dated start,
is recorded on the stay without refusal (open item 8). **O-2** error toasts stay until closed (G3-05 walk O-1). **O-3** a
direct load of `#/patients/…` lands on Yataklar (G3-05 walk E-10). **O-4** the seeded tenant's zone is «UTC» (Görevlerim
reads «Nöbet 00:00 → 00:00»; open item 7). **O-5** in the forced refusals the field kept the in-bounds time typed while the
server judged the rewritten one — an artefact of the forcing, not a screen behaviour.

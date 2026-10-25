# Group 2 · Lane B · slice B1a — Admission and discharge ("Hasta Kabul")

**Date** 2026-10-25 · **Status** approved in conversation section by section (the user's
"Doğru" ×3, "onayladim"), awaiting the user's read of this file ·
**Branch** `feat/g2b-kabul` (from origin/main `03daac4`; worktree `/c/tmp/g2b-kabul`)
**Roadmap** `docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md` — Group 2
scope ("kabul/transfer/taburcu"), the G1-15 list of capabilities Group 2 brings back, and
"Main'den gelen ve yeni kabukta karşılanacak davranışlar" (`admissionScreen`, `clinicalCharting`).
**Lane** B of the two-session split agreed 2026-10-25 (Lane A: patient screen and engine, the
other session). Backend files owned by Lane A are named in §7; every change there is agreed with
that session first.
**Prototype** `tasarim-taslaklari/app/admin.js` page "admission" (form, bed picker, discharge),
`screens.js` (bed actions), on `origin/tasarim/prototip` — the visual language and the field list;
its data, numbers and roles are synthetic and do not carry.

## 1. What this slice delivers

Today nobody can say on a screen "this patient lies in this bed". Two worlds exist and nothing
joins them:

- the **admissions world** — `admission/` and `tenant/` in Postgres: patients, admissions, units,
  rooms and beds keyed by UUID, with a working DRAFT → ACTIVE → discharge state machine, but no
  screen, and nothing it does reaches the board;
- the **board world** — the engine keyed by a patient-id string, the identity store
  (`api/patient_identity.py`) fed only by the HIS ADT feed (which has never flowed on the VM) or a
  manual script, and bed labels from `bed-mapping.json` (a directory on the VM, so no card lands
  on a bed).

B1a joins them and gives the ward its first admission screen:

- **Yönetim › Yapı** — the administrator builds the ward: sites, units, rooms, beds;
- **Hasta Kabul** — Kabul (admit), Taburcu (discharge), Yataklar (bed states, bed release);
- an admission creates the board card at once, in the right bed and unit, with a Homunculus
  patient number the nurse enters on the bedside device; weight and comorbidities reach the engine;
- the physician signs the admission from the patient screen; discharge is started by the physician
  with a disposition and confirmed by the charge nurse; the card leaves the board; the bed goes to
  cleaning and a nurse releases it.

Transfer (B1b), care team (B1c) and labels/barcodes (B1d) follow in their own slices.

## 2. Decisions (the user's, 2026-10-25)

| # | Decision | Why |
|---|---|---|
| D1 | **A Homunculus admission is the source of truth for which patient lies in which bed.** The HIS feed, when it exists, only prefills; it is linked by the stored HIS protocol number. | The ADT feed has never flowed on the VM; clinicians have no way to place a patient. Stage B's monitor→patient link (Decision 9 of the Aşama A plan) needs an explicit bed→patient binding. |
| D2 | **First slice = admission + discharge together** (B1a). Transfer, care team, labels later. | A bed must be emptied by the same slice that fills it. |
| D3 | **The card and monitoring start at admission.** Physician sign-off (DRAFT → ACTIVE) is a later step; until then the card and patient screen say "hekim imzası bekliyor". | The patient is physically in the bed; a late signature must not leave them unwatched. The backend already occupies the bed at DRAFT. |
| D4 | **Homunculus generates the patient number.** The HIS protocol number is a separate, optional field. The nurse enters the Homunculus number on the bedside device. | The user's choice. Readings then reach the right card by that number. |
| D5 | **The prototype's full admission form.** | The user's choice; most fields need new, encrypted columns (§4.1). |
| D6 | **Nurse and charge nurse admit** (today's permissions unchanged). Physicians see admissions and sign; they do not admit. | Night shift has no clerk; the engine's groups already say so. |
| D7 | **Discharge in two steps with a disposition.** The physician starts it and picks home / other institution (name) / exitus (reporting physician) + time + note; the charge nurse confirms when the patient has left. An open critical alarm blocks the start. | The user's choice; keeps the order (physician decides) and the fact (bed empty) apart. |
| D8 | **Nurse and charge nurse may mark a cleaned bed free** — a new narrow permission `beds.release` (HOUSEKEEPING → AVAILABLE). Changing the structure stays `structure.manage` (administrator). | A ward must turn beds over at night without an administrator. |
| D9 | **UUID everywhere.** The database id of a unit and a bed is the one bed vocabulary: the board identity, the Infinity device→bed table, staff scope grants and (later) `bed-mapping.json` values all carry it. Screens resolve names from a structure read endpoint; no UUID is ever shown. | The user's choice over a readable code. |
| D10 | **An administrator "Yapı" tab builds the structure** (add, rename, close; a bed with a patient cannot be closed). | The VM has no structure rows and no way to create them; file-based setup would make every bed change a VM job. |

## 3. Flows

### 3.1 Admission (Kabul tab; `admissions.admit`)

1. The nurse fills the form (§5.2). The bed picker offers only AVAILABLE, open beds in units she is
   scoped to. "Kabul et" stays disabled while a required field is missing; the side panel names
   each missing field.
2. `POST /admissions` (one request) — the server, in one transaction:
   - locks the bed row (`SELECT … FOR UPDATE`), refuses unless AVAILABLE and open and in the
     caller's unit scope;
   - creates the `Patient` row with its new fields and a fresh **patient number** (§4.2);
   - creates the admission in DRAFT and sets the bed OCCUPIED (existing behaviour);
   - writes the audit row `admission.admit` (who, bed, patient number — no name).
3. After commit the server (§4.3):
   - writes the board identity (source `kabul`, key = patient number, name, birth date, sex, bed
     label, `bed_id`, `unit_id`) → the card appears in that bed, visible to that unit's staff;
   - charts `weight_kg` and applies the profile (comorbidity codes) through the engine.
   If either engine write fails the admission stays; the response says which part did not reach
   the engine, and the screen says so ("kilo motora iletilemedi — hasta ekranından girin").
4. The screen shows the patient number large, with "cihaza bu numarayı girin", and "Panoda gör".

### 3.2 Physician sign-off (patient screen; `admissions.sign_off`)

A DRAFT admission shows a strip "Hekim imzası bekliyor" on the patient screen and a badge on the
card. A physician presses "Kabulü imzala"; the server sets `attending_physician_id` to the caller
when none is set and moves DRAFT → ACTIVE (existing route, which today refuses without an
attending). Audit `admission.sign_off`. No physician picker is needed in this slice.

### 3.3 Discharge (Taburcu tab)

1. **Start** (`admissions.move.initiate` — attending, unit physician): on an admitted patient,
   "Taburcuyu başlat" opens a dialog: disposition (home / other institution + institution name /
   exitus + reporting physician — the caller by default, free text allowed), discharge time
   (default now, not in the future), note (≤ 2000). The server refuses with `critical_alarm_open`
   when the board shows the patient an alert of severity `critical` that nobody has acknowledged —
   the same alerts and acknowledgements the clinician sees (§4.4). With Lane A's A1 (O17) a
   critical alert that has stopped firing stays on the board "resolved, unacknowledged" until it is
   acknowledged; it blocks discharge too, so a critical event is always seen before the patient
   leaves. Admission →
   PENDING_DISCHARGE, bed → PENDING_DISCHARGE. Audit `admission.discharge_start`.
2. **Confirm** (`admissions.discharge.confirm` — charge nurse): "Hasta çıktı · onayla". Admission →
   DISCHARGED, bed → HOUSEKEEPING, care-team rows closed (existing), board identity → discharged →
   the card leaves the board for every subscriber, scoped ones included (§4.3). Audit
   `admission.discharge_confirm`.

### 3.4 Bed release (Yataklar tab; `beds.release`)

A HOUSEKEEPING bed in the caller's units shows "Temizlik bitti · boş" → AVAILABLE. Audit
`bed.release`.

### 3.5 Structure (Yönetim › Yapı; `structure.manage`)

Tree: site → unit (name, type) → room (name, number, isolation) → bed (label). Add, rename, close
(`is_active = false`; a bed that is not AVAILABLE/HOUSEKEEPING/BLOCKED cannot be closed; a unit or
room with an open bed under it cannot be closed). Reopen is allowed. Nothing is deleted.

## 4. Backend

### 4.1 Data (migration `0012`)

- `patients`: `patient_number` (String 16, unique per tenant, not null for rows created from now
  on — existing rows, if any, get numbers in the migration), and encrypted (`EncryptedString`, as
  name and birth date) `father_name`, `nationality`, `national_id` (FİN), `passport_no`,
  `phone`, `relative_name`, `relative_relation`, `relative_phone`, `companion_name`; plain
  `consent` (enum KVKK_SIGNED / UNCONSCIOUS_LATER), `sms_permitted` (bool).
- `admissions`: `admission_type` (enum MEDICAL / SURGICAL / ICU / PROCEDURE, the prototype's
  `ADM_T`), `blood_group` (enum A+ … O−, UNKNOWN), `allergies_text` (≤ 500) and
  `no_known_allergy` (bool; exactly one of the two), `comorbidity_codes` (list of engine codes),
  `comorbidities_text` (≤ 500); discharge: `discharge_disposition` (HOME / OTHER_INSTITUTION /
  EXITUS), `discharge_institution`, `discharge_reported_by`, `discharge_at`, `discharge_note`.
- `beds.is_active` (bool, default true).
- `patient_number_counters` (tenant_id, year, last) — the number source (§4.2).
- `patient_identity`: `bed_id`, `unit_id` (nullable strings) and source `kabul` allowed.
- Data migration: add `beds.release` to the `nurse` and `charge_nurse` groups of every existing
  tenant (`ensure_default_groups` never adds keys to existing groups).
- Model/migration parity checked as in `0011`'s test; upgrade/downgrade round trip.

### 4.2 Patient number

`H` + two-digit year + five-digit sequence, e.g. `H2600042`. Per tenant and calendar year (UTC),
taken from `patient_number_counters` under a row lock in the admission transaction, so two
admissions can never share one. The prefix keeps it out of the HIS protocol-number namespace (a
generated number equal to a HIS number would merge two patients on one card — the "X" incident);
no `/` (path routes), no `_` (the NCE PID split), no HL7 delimiter. Year rollover restarts at 1.
At 99 999 in one year the admission is refused with `patient_number_exhausted`.

### 4.3 The join to the board

- `IdentityRecord` gains optional `bed_id` and `unit_id`; `as_board()` publishes them; the board's
  bed resolution uses the record's own ids when present and falls back to `bed-mapping.json` only
  for HIS-fed records. The card's `bed_label` is the tenant bed label.
- A narrow `BoardLink` service (new module in `admission/`) is the only way admission code touches
  the board: `put_identity(tenant, record)`, `chart_weight(tenant, patient_number, kg)`,
  `apply_profile(tenant, patient_number, codes)`, `open_critical(tenant, patient_number)`,
  `discharge_identity(tenant, patient_number)`. It is built in `api/app.py` from the existing
  identity store, engines, ack stores and broadcaster and placed on `app.state` (Lane A file, §7).
- **Discharge leaves the board for good.** A `kabul`-source discharged identity is kept as a
  tombstone (no 24 h prune) so a patient with readings does not come back as a nameless card; the
  board omits patients whose identity is discharged; readings later arriving for a discharged
  number are kept by the engine and counted, not shown. The `removed` frame carries the last bed
  and unit so scoped SSE subscribers receive it (today they never do — roadmap open item, taken
  over from Lane A's A2 with that session's agreement).
- The Infinity shadow lane's `_occupants` resolves a device's bed to its patient by the identity's
  own `bed_id` (the table row's `bed_id` is the tenant bed UUID from now on).
- Scope: `own_patient_ids` maps care-team rows through `Patient.patient_number` as well as
  `his_patient_reference`. Unit and bed grants are tenant UUID strings.

### 4.4 Routes

Changed (existing paths):

- `POST /admissions` — the extended form; unit scope; bed lock; returns the patient number and
  `engine: {weight: ok|failed|skipped, profile: ok|failed|skipped}`.
- `GET /admissions` — `state` filter added; each row carries patient number, display name, bed and
  unit labels (for the Taburcu list), limited to the caller's units.
- `POST /admissions/{id}/sign-off` — sets the caller as attending when none is set.
- `POST /admissions/{id}/discharge/initiate` — disposition fields; the open-critical check reads the
  engine via `BoardLink.open_critical` instead of the Postgres escalation tables (never written on
  the VM).
- `POST /admissions/{id}/discharge/confirm` — also discharges the board identity.

New:

- `GET /tenant/structure` — sites, units, rooms, beds (ids, names, labels, states, `is_active`)
  limited to the caller's units; for holders of `admissions.view`, `admissions.admit`,
  `beds.release` or `structure.manage`. Screens and the top bar resolve every unit and bed name here.
- `POST /tenant/beds/{id}/release` — HOUSEKEEPING → AVAILABLE; `beds.release`; unit scope.
- `PATCH /tenant/units|rooms|beds/{id}` — rename, close, reopen; `structure.manage`.

Every refusal returns a stable code (`bed_not_available`, `bed_closed`, `out_of_scope`,
`critical_alarm_open`, `patient_number_exhausted`, `invalid_transition`, `missing_attending`,
`field_invalid:<name>` …) alongside the text; the dashboard maps codes, never text. Every new or
changed route is added to `test_route_permissions.py` and the tenant-isolation suite.

### 4.5 Unit scope (roadmap decision 5, for these routes)

Admission, discharge and bed routes check the target bed's unit against the caller's unit and bed
grants (unrestricted callers pass). Lists are filtered the same way. Escalation and handover routes
are not touched here (B3, B5).

## 5. Screens

### 5.1 Menu

"Hasta Kabul" (new route), visible with any of `admissions.view`, `admissions.admit`,
`admissions.discharge.confirm`, `beds.release`. Tabs: **Kabul · Taburcu · Yataklar**, each gated by
its permission (physicians see Kabul read-only with a note, as the prototype does). Route and menu
lines sit in the Lane B block of the shared seams (`// G2-B1a`).

### 5.2 Kabul tab

Form (prototype `admin.js` "Elle kayıt"), grouped:

- **Kimlik**: ad soyad*, baba adı, cinsiyet*, doğum tarihi* (age shown, not editable), uyruk, FİN
  (7 alphanumerics), pasaport, telefon (+994 …);
- **Kabul**: kabul türü*, kaynak, kabul tanısı*, kilo, boy, kan grubu, alerji (text) or "bilinen
  alerji yok"* (one of the two), eşlik eden hastalıklar — checkboxes for the engine's codes (KOAH,
  kronik solunum yetmezliği, evde oksijen, demans/kronik konfüzyon) plus free text (stored, not
  sent as a code), HBYS protokol no;
- **İletişim ve onam**: yakını (ad, yakınlık, telefon), refakatçi, onam* (KVKK imzalandı /
  bilinci kapalı — sonra), SMS izni;
- **Yatak***: unit → room → bed grid; only AVAILABLE, open beds selectable; occupied, cleaning and
  closed beds shown dimmed with the reason.

A right-hand panel lists every missing required field by name; "Kabul et" is disabled until it is
empty. After success: the patient-number box ("cihaza bu numarayı girin"), any engine warning, and
"Panoda gör".

### 5.3 Taburcu tab

Two sections: "Taburcusu başlatılan" (awaiting the charge nurse's confirmation) and "Yatan
hastalar". Physicians get "Taburcuyu başlat" (dialog of §3.3; disabled with the reason when a
critical alarm is open); charge nurses get "Hasta çıktı · onayla".

### 5.4 Yataklar tab

The caller's beds by unit and room with their state; "Temizlik bitti · boş" on HOUSEKEEPING beds.
A small precursor of B3's occupancy screen.

### 5.5 Patient screen and card

DRAFT admission: strip "Hekim imzası bekliyor" + "Kabulü imzala" for `admissions.sign_off`
holders; a small badge on the bed card.

### 5.6 Yönetim › Yapı

The tree of §3.5 as a fourth admin tab, built from the shell's existing components.

### 5.7 Rules every screen keeps

Four languages (az default), Gece/Gün, 390 and 1440 px, screen reader and keyboard, results said
on screen as well as in a toast, no raw key, no UUID, the top bar's unit chooser shows unit names
from `/tenant/structure`.

## 6. What does not change

The engine's rules and thresholds; NEWS2; alarms and sound; the Stage A strip's values; the HIS ADT
path (HIS-fed records keep working as today; a HIS record and a `kabul` record can never share a
key, §4.2).

## 7. Lane A coordination (files Lane A owns)

Each item is agreed with the other session before it is changed, and listed in the plan:

1. `api/app.py` — build `BoardLink` and put it on `app.state`; `_occupants` by the identity's
   `bed_id`; the `removed` frame carries the last bed/unit.
2. `api/board.py` — bed resolution prefers the record's ids; discharged `kabul` identities are
   omitted.
3. `api/patient_identity*.py` — `bed_id`/`unit_id`, source `kabul`, tombstones (identity is shared
   ground; the change is additive).
4. `api/clinical.py` — none expected (weight and profile go through the existing engine calls).

## 8. Tests

- **Backend** (TDD, red first, Python 3.12 and 3.14, Postgres where the code needs it):
  - patient numbers: unique, two concurrent admissions never share one, year rollover, exhaustion;
  - the whole flow: admit → card on the right bed and unit → sign-off → discharge start →
    confirm → card gone for scoped and unscoped subscribers → bed cleaning → released;
  - refusals: closed or occupied bed, out-of-unit admission, critical alarm open, missing
    attending, every `field_invalid`;
  - engine-write failures leave the admission and are reported;
  - migration `0011 → 0012 → 0011 → 0012` on the real Alembic chain, model parity, the
    `beds.release` data migration on an existing tenant;
  - tenant isolation for every new or changed route; the route-permission table; the permission
    catalogue parity with the dashboard.
- **Dashboard**: form validation and the missing-fields panel; the bed picker; the number box;
  discharge dialogs; bed release; the Yapı tab; the sign-off strip; four languages, no raw key, no
  UUID on any screen; the unit chooser shows names.
- **Local walk** on a separate stack (`g2b`, port 18090), headless Chrome: build a structure, admit
  two patients, sign one, discharge one, release the bed, bind an Infinity row to a bed and see the
  strip on the patient's card.

## 9. Deploy (blocks the user pastes; one deploy at a time across both lanes)

1. Read-only check: structure rows and staff-scope grants on the VM (counts only).
2. api + web rebuilt, migration `0012`; rollback = database dump + previous image tags.
3. The administrator builds the structure in Yönetim › Yapı.
4. A new version of the Infinity device→bed table with tenant bed UUIDs, approved by the user.
5. Old free-text scope grants (if any) are flagged in Yönetim for re-selection, never silently
   dropped.
6. Acceptance walk with the user on a real admission: number on the device, card on the right bed,
   monitor on the card, discharge, bed release.

## 10. Not in this slice / open items

- B1b transfer, B1c care team, B1d protocol/patient labels and barcodes.
- The "HBYS'den bekleyen" panel (when the ADT feed exists).
- Matching a readmitted person to an earlier patient row (a readmission gets a new number).
- The unknown/unidentified patient (admission without a birth date).
- The device showing the patient's name for a `kabul` patient (the edge PDQ mirror is fed by ADT
  only).
- Native reading of the az/ru/en texts.
- Old free-text scope grants after `0012` (flagged, §9).

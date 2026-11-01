# G2-B1d · Protokol: the visit number Homunculus issues, its barcode label, and the bedside device's patient query — design

**Date:** 2026-11-01 · **Lane:** B (item B1d of the B1 list), run by session `homunculus-ai-0a` in parallel with Lane B's
device→bed editor · **Branch:** `feat/g2b-protokol`, off `main` `ec66a57` · **Worktree:** `/c/tmp/g2b-protokol`.
Code references were read at `ec66a57`. **Owner decisions:** taken in conversation on 2026-11-01 (§2). After §4 was
presented, the owner handed the rest of the process to the controller («Lane A ve Lane B'ye bakarak bu süreci kendin en
doğru şekilde yap»). §7–§12 are the controller's calls under that delegation.

## 1. The problem

On a Welch Allyn Connex Spot the nurse types or scans a patient id before saving vitals. The device's server (NCE) sends
that id as an HL7 patient query (`QBP^Q22`) to its "patient query" host, Host1. Host1 has pointed at our bridge
(`172.100.101.72:2575`) since 2026-09-04. The bridge answers in `edge/pdq.py`: it echoes the id, and adds a name only
when the bridge's identity mirror (`edge/identity.py`) knows the id. That mirror is fed **only** by Comed ADT, which has
never flowed. So the device never shows a name. The B1a spec lists this as an open item (§10: "the edge PDQ mirror is
fed by ADT only").

In the hospital's own numbering (owner, 2026-11-01), a person has **one patient number for life**, and **every visit
opens a new protocol number** under it: a hair transplant now and traumatology a year later are two protocols with the
same patient number. A Homunculus admission is a visit, so one protocol = one admission = one card on the board. The
owner wants the protocol to be what the nurse enters on the device, and wants Homunculus itself to issue it. Homunculus
is to become the hospital's HBYS. That is a program of its own (§12); this slice is its first visible piece.

Today B1a gives each admission a Homunculus number `H2600042` (D4 of the B1a spec). It sits on the `Patient` row, is the
board key, and is what the nurse types. The form's "HBYS protokol no" (`Patient.his_patient_reference`) is optional and
encrypted, so it cannot be looked up by value.

## 2. Decisions

| # | Decision | Source |
|---|---|---|
| D1 | **Homunculus issues a protocol number for every new admission.** It is mandatory: an admission without one is never written. | Owner («protokol açılmalı, kendi üretsin») |
| D2 | **Only the protocol in this slice.** The H-number stays as it is today (issued per admission, kept on `Patient`), is not printed on the label, and is not the key of a new admission's card. A permanent patient number and matching a returning person to their earlier record belong to the HBYS program. | Owner, Q1 = A |
| D3 | **Twelve digits, all of them sequence. No check digit.** So a single mistyped digit can give a neighbour's valid number, and the name on the device is the only safeguard: **a found number is ALWAYS answered with the name.** | Owner, Q2 = B |
| D4 | **A number Homunculus does not know, or a discharged one, is answered "not found"** (`QAK … NF`, no `PID`). The device cannot validate it, so the nurse corrects it at the bedside. If the nurse saves anyway, the reading lands as today: a nameless "kimlik kaydı yok" card. | Owner, Q3 = A |
| D5 | **The administrator sets the next number** in Yönetim › Protokol ve etiket (12 digits, e.g. `202600000001`). It may only move **forward**: a new value must be greater than the last number issued. **No admission is possible until it is set**, because a number range Homunculus picked by itself could collide with the old HBYS's protocols. | Owner (section 1 «doğru») |
| D6 | **Label: 50×30 mm, for Zebra printers, by default.** Width, height and printer resolution live in the same admin tab. | Owner («50x30mm zebralar için, admin panelde bu alanda olsun») |
| D7 | **The protocol is the card key of a new admission.** The number on the device, the label and the card are the same. Admissions open before this slice keep their H-number key until discharge, and the device keeps accepting H-numbers. | Owner, approach 1 |
| D8 | **When the API does not answer** (2 s timeout or error), the bridge answers from its own mirror. A hit is answered with the name; a miss echoes the id without a name, as today. The reading is not lost, and "we do not know" stays distinct from "not found". | Owner, section 3 = A |
| D9 | **Break-glass returns the card key too** (`scope/resolver.py` `break_glass_in_tenant` returns only `his_patient_reference` today, so it appears to grant nothing for a patient admitted in Homunculus. Read in code, not reproduced). | Owner (section 2 «doğru») |
| D10 | **Code 128-C barcode.** It encodes digit pairs, so the 12-digit number takes 6 data symbols. One bar module = 3 printer dots at 203 dpi (0.375 mm) or 4 dots at 300 dpi (0.339 mm). The quiet zone is 10 modules on each side. The barcode is ≈45 mm wide at 203 dpi, so it fits a 50 mm label. Code 128-B, the prototype's encoder, would need 187 modules instead of 121 (≈1.5×) and would not fit at 3 dots. | Controller (presented in §4) |
| D11 | **No new permission key.** The settings use `structure.manage`; printing uses `admissions.admit` within the printer's own units. | Controller |
| D12 | **The device-query route is reachable only on the compose network.** It is not added to nginx's proxied prefixes, accepts only the bridge's device credential, and answers one exact number at a time. | Controller |

## 3. Numbering and settings

**Data (migration `0015_protocol`; see §9 for its place in the chain).**

- New table `protocol_settings`, one row per tenant, primary key `tenant_id` (FK `tenants.id` `ON DELETE CASCADE`):
  - `next_no BIGINT NULL`: the number the next admission receives. NULL means "not configured" (D5).
  - `last_issued BIGINT NULL`: the last number given out. NULL means "none yet".
  - `label_width_mm SMALLINT NOT NULL DEFAULT 50`, `label_height_mm SMALLINT NOT NULL DEFAULT 30`.
  - `printer_dpi SMALLINT NOT NULL DEFAULT 203`, with CHECK `printer_dpi IN (203, 300)`.
  - `updated_at`, `updated_by` (user UUID, nullable).
- `admissions.protocol_no VARCHAR(12) NULL`, with a partial unique index on `(tenant_id, protocol_no)` WHERE
  `protocol_no IS NOT NULL`. Rows already in the table stay NULL. The column is stored in the clear because it is a
  key, like `patient_number`. CHECK `protocol_no ~ '^[0-9]{12}$'`.
- Model/migration parity is checked as in `0012`'s test, together with an upgrade/downgrade round trip.

**Issuing (`protocol/numbers.py`, new).** `next_protocol_no(db, tenant_id)` runs inside the admission's own
transaction, the same pattern as `admission/numbers.py`:

```sql
UPDATE protocol_settings
   SET last_issued = next_no, next_no = next_no + 1
 WHERE tenant_id = :t AND next_no IS NOT NULL
RETURNING last_issued
```

- No row, or `next_no` NULL → `Refusal(409, protocol_not_configured)`.
- `last_issued > 999_999_999_999` → `Refusal(409, protocol_exhausted)`; the whole transaction rolls back.
- The row lock lasts until the admission commits or rolls back, so two admissions never share a number. A refused or
  rolled-back admission gives its number back, so the sequence has no gaps.
- The number is formatted on 12 digits, zero-padded.

**The setting (`protocol/router.py`, new).**

- `GET /admin/protocol-settings` and `PUT /admin/protocol-settings` (`structure.manage`, own tenant).
- PUT accepts `next_no` (exactly 12 ASCII digits), `label_width_mm`, `label_height_mm`, `printer_dpi`.
- Rules:
  - `next_no` must be greater than `last_issued` when one exists (`protocol_not_forward`, 409). Lowering it back
    towards `last_issued + 1` is allowed: no number is reused either way.
  - The size must hold the barcode: `width_mm ≥ (121 × module_mm) + 2 × 1.5 mm` (`label_too_narrow`, 422; at 203 dpi
    that is ≥ 48.4 mm). Bounds: width 30–110, height 20–80 (`label_size`, 422).
  - The client mirrors the same formula, and a parity test pins both sides to one table of cases.
- Every change writes the audit row `protocol.settings`: who, old/new `next_no`, and old/new size and resolution.
  No patient data is involved.

## 4. The card key

One rule, in one helper, `admission/boardkey.py`: `board_key(protocol_no, patient_number) = protocol_no or
patient_number`. Every place that ties an admission to the board calls it; none of them reads `Patient.patient_number`
for that purpose any more:

- **`admission/router.py`:** admission (`kabul_record`, the identity write, weight and profile to the engine), sign-off,
  discharge start and confirm (`open_critical`, `discharge_identity`, `retire`), and the admission list and detail
  responses, which gain `protocol_no` and `board_key`. The `admission.admit` audit row gains `protocol_no`.
- **`scope/service.py` `read_own_patient_ids`:** the care team's "own patients" list includes the key.
- **`scope/resolver.py` `break_glass_in_tenant`:** D9.
- **Lane B's editor `devicebeds/service.py` `_open_admission_number`** (≈ line 208 on `feat/g2b-esleme-be` @
  `2e311e9`, not on main yet): it reads `Patient.patient_number` of the open admission on a bed. That value reaches the
  `bed_occupied` refusal's `occupied[].patient_id`, which the dialog uses to find the card and show «Ahmet Y.». It uses
  `board_key` after B1d; `_patient_of`, which only picks the audit row's id, stays as it is. Whichever of the two slices
  lands second adapts it, and tests `occupied[].patient_id` for a kabul patient admitted after B1d (Lane B,
  2026-11-01, corrected the same day). Lane A's `app.py` `_occupants_now` reads kabul records by `bed_id`. The record's own key is the card
  key, so it needs no change; the plan confirms this in a test.
- **Dashboard:** every match between an admission and a card uses `board_key`: `BedsScreen.jsx` `draftNumbers`,
  `DischargeTab.jsx`, `SignOffStrip.jsx`, and `AdmitTab.jsx`'s result box.

`BoardLink` itself does not change: it already takes the key as a string. The engine, alerts, acks, trends and the
Infinity shadow key all run on the card key, so a new admission's alerts are keyed by its protocol with no further code.
The Infinity monitor→card link goes through the identity record's `bed_id`, which does not change. A test pins it with
a protocol-keyed card.

**Screens.**

- The admit result box shows the protocol number large, with "Cihaza bu numarayı girin veya barkodu okutun" and
  **Etiketi yazdır**. The strings are added in tr/az/en/ru.
- The card and the patient screen show the key where they show the H-number today. A legacy admission still shows
  its H-number.

## 5. The device query

```
Connex Spot ─(typed / scanned id)→ NCE ─QBP^Q22→ bridge :2575 answer_query
     bridge ─POST /edge/patient-query (device token, 2 s)→ API ─ identities.get(tenant, id)
```

1. **API (`api/edge_query.py`, new; mounted in `app.py`).** `POST /edge/patient-query` takes `{"id": "<number>"}` in
   the body; POST keeps the number out of access logs.
   - `_caller` must be a device (`403` otherwise); the hospital is the caller's.
   - It reads the board identity record (`identities.get(hospital, id)`): the record the admission wrote, keyed by the
     card key, which holds name, birth date and sex.
   - `None`, `is_tombstone(record)`, or a HIS record in state discharged → `{"found": false}`.
   - Otherwise → `{"found": true, "family", "given", "birth_date", "sex"}`. A Comed-fed record is answered the same way.
   - `id` must be a non-empty string of at most 64 characters (`400`). Exact match only: no list, no prefix, no search.
   - **Any exception** from `identities.get` or `is_tombstone` → `503`, never `{"found": false}`. After Lane A's bounds
     slice (`fix/pg-bounds`), the Postgres store raises `OperationalError` within a few seconds on a stalled
     database. "We cannot answer" must not look like "patient unknown" (Lane A, 2026-11-01).
2. **Bridge (`edge/bridge.py` `answer_query`).** It asks the API first, through a small client (`edge/pdq_client.py`,
   new; the URL is derived from `--cloud-url` + `/edge/patient-query`, with the `--token` already used for `/ingest`):
   - **found** → `RSP^K22` with `MSA|AA`, `QAK|…|OK` and the field-complete `PID|||id||name||dob|sex`, the name always
     included (D3). The answer is upserted into the mirror (encrypted, state admitted).
   - **not found** → `MSA|AA`, `QAK|…|NF`, no `PID` segment (D4); the id is dropped from the mirror
     (`IdentityMirror.forget`, new).
   - **unreachable / timeout / non-200 / malformed** → the mirror's answer if it has one, otherwise today's echo
     without a name (D8).
   - Counters: `queries`, `queries_not_found`, `queries_api_failed`, shown in the report line. **No id is logged.**
3. **No stall.** `edge/mllp.py` `serve_mllp` today calls the responder synchronously on the event loop. It will call it
   through `asyncio.to_thread`, so a 2 s API wait never holds the ORU traffic of other connections. NCE waits 10 s for
   an answer, which leaves 8 s of margin.
4. **Readings** arrive with PID-3.1 = the protocol, reach `/ingest` unchanged, and land on the card whose key is that
   protocol. Nothing changes on the ingest path.

`pdq.patient_query_response` gains an explicit "not found" outcome. Today the lookup's `None` means "echo without a
name". The lookup will return one of three answers: found(identity) / not_found / unknown. `unknown` keeps today's
behaviour.

## 6. Label and printing

**Encoder (`dashboard/src/live/screens/kabul/label/code128c.js`, new).** A pure function from a string of an even number
of digits to the symbol values `[105 START-C, …pairs, checksum, 106 STOP]`. The pattern table is taken from the
prototype (`tasarim/prototip` `dashboard/src/patientLabel.js`). Input that is not an even-length digit string → `null`,
and nothing is drawn. Tests: the table's module sums and uniqueness; the checksum; the drawn bars **decoded back** to the
same 12 digits by an independent decoder in the test; and the fixed width of 121 modules for 12 digits.

**Layout (`label/protocolLabel.js`, pure + a print function).** The label is in mm, from the settings. Lines are
dropped when empty, never written as "—":

1. barcode, ≈10 mm high, module from the dpi (D10);
2. the protocol number in large print;
3. full name (never masked: the screen's masking preference does not apply to paper);
4. birth date · sex;
5. unit · bed.

The line labels follow the printing user's screen language. A larger configured size prints the same lines larger. There
are no allergy/DNR chips on a 50×30 label in this slice.

**Printing.**

- A print window with `@page { size: <w>mm <h>mm; margin: 0 }`, then `window.print()`. The setup note says the Zebra
  driver must carry the label stock in that size, at 100 % scale.
- **Deneme etiketi yazdır** in the admin tab prints only synthetic data (`000000000000`, "DENEME ETİKETİ"). It is built
  in the browser, with no API call.
- **Who and where.** The admit result box (first print) and the patient screen (reprint), for users with
  `admissions.admit` whose units include the bed.
- **Data.** `POST /admissions/{id}/label` with `{"reprint": bool}` returns exactly the label's fields
  (`protocol_no`, name, birth date, sex, unit name, bed label) plus the label settings, and writes the audit row
  `admission.label_print` (who, admission, protocol no, reprint; **no name**). POST because every print is an audited
  act. An admission without a protocol has no label (`409 no_protocol`), and its print button is not shown.

## 7. Errors and refusals

| Where | Condition | Answer |
|---|---|---|
| admit | settings missing / `next_no` NULL | 409 `protocol_not_configured`, nothing written; the screen points to Yönetim › Protokol ve etiket |
| admit | sequence past 999 999 999 999 | 409 `protocol_exhausted` |
| PUT settings | `next_no` not 12 digits | 422 `protocol_format` |
| PUT settings | `next_no` ≤ `last_issued` | 409 `protocol_not_forward` |
| PUT settings | size out of bounds / barcode does not fit / dpi not 203 or 300 | 422 `label_size` / `label_too_narrow` / `label_dpi` |
| label | admission has no protocol | 409 `no_protocol` |
| label | outside the caller's units / other tenant | the admission router's existing scope refusals |
| patient-query | not a device | 403 |
| patient-query | bad body | 400 |
| bridge | API down / slow / wrong | mirror → echo without name, counted (D8) |

All refusal codes are added to `admission/errors.py` in their own `# G2-B1d` block and to the dashboard's refusal
strings in tr/az/en/ru.

## 8. Security and PHI

- The device credential gains its first **read**: name, birth date and sex for one exact number. It already writes
  vitals and identities (`/ingest`), so a holder of it could already do worse. The route is still closed to the outside
  (D12), takes POST bodies only, matches exactly, and is never logged by number.
- The bridge mirror holds names encrypted (`PHI_ENCRYPTION_KEY`, already in the bridge's environment). A not-found
  answer removes the row, so a discharged patient's name does not stay on the bridge disk after the next query for that
  number.
- The label prints the full name: that is its purpose. The audit row of a print carries no name.
- Tests and examples use synthetic names and numbers only (`202600000001`, "Test Hasta").

## 9. Lanes and seams

| File / area | Owner | How |
|---|---|---|
| `protocol/` (new), `admission/boardkey.py` (new), `admission/router.py`, `admission/models.py`, `admission/schemas.py`, `admission/errors.py` (own block), `scope/service.py`, `scope/resolver.py` | Lane B | this slice |
| `api/app.py`: mount `edge_query` + `protocol` routers (two lines, beside the research router) | Lane A | hunk sent for review before merge |
| `api/edge_query.py` (new; reads `patient_identity.is_tombstone`, does not change it) | Lane A area | hunk sent for review |
| `edge/mllp.py`, `edge/bridge.py`, `edge/pdq.py`, `edge/identity.py`, `edge/pdq_client.py` (new), `scripts/run_bridge.py` | NCE path; shared `edge/` | told to Lane A; no Infinity file is touched |
| dashboard: `screens/admin/AdminScreen.jsx` TABS line `// G2-B1d`, new `screens/admin/ProtocolTab.jsx`, `screens/kabul/*`, `screens/beds/BedsScreen.jsx`, patient screen print button, strings `// G2-B1d` | Lane B | lane-marked seams |
| `alembic/versions/0015_protocol.py` | Lane B | **chain:** Lane B's editor adds `0014_device_beds` (not on main yet). This branch points `0015`'s `down_revision` at `0013_monitor_samples` until the editor reaches main; then it rebases and repoints to `0014_device_beds` (the plan's merge task). If the owner calls this slice to main first, the names swap instead: this slice becomes `0014`, the editor `0015`. |

Overlap with the editor branch, merged by whichever lands second: `admission/errors.py`, `app.py` (router lines),
`catalogue.js`/`perms.js` (none planned here), `tests/conftest.py` (table list), `AdminScreen.jsx` (TABS).

## 10. Testing

- **Engine:**
  - the protocol counter on real Postgres: two concurrent admissions get two consecutive numbers; a refused admission
    gives its number back; not configured; exhausted;
  - the settings rules (forward only, size and dpi bounds, the barcode-fit formula from the shared case table);
  - the migration: parity, round trip, the partial unique index, the CHECKs;
  - `board_key` at every call site: a new admission's card, alerts, weight and profile under the protocol; a legacy
    admission under its H-number; discharge and retire under the key; the "own patients" and break-glass lists;
  - the Infinity bed link with a protocol-keyed card;
  - `/edge/patient-query`: found, unknown, tombstone, HIS discharged, non-device 403, body 400; the route absent from
    nginx's prefixes (`test_nginx_routes.py`);
  - the label route: payload, audit row without a name, scope, 409 `no_protocol`;
  - `pdq`: found → name always, NF → no PID, unknown → echo; the bridge: API first, mirror fallback, forget on NF,
    counters, and a 2 s stub API that does not stall a concurrent ORU (to_thread);
  - the route-permission table includes the three new routes.
- **Dashboard:** Code 128-C (table, checksum, round-trip decode, width); the label lines (dropped when empty, full name);
  the barcode-fit formula from the same case table; ProtocolTab (forward-only refusal shown, test print synthetic);
  the admit box (protocol shown, print button); key matching in Beds/Discharge/SignOff; strings in four languages.
- **Local walk (compose):**
  1. set the start number;
  2. admit → the protocol is shown → print preview;
  3. a synthetic `QBP^Q22` over MLLP → `RSP^K22` with the name;
  4. a synthetic ORU with that protocol → the card updates;
  5. discharge → the same query → `NF`;
  6. API stopped → echo without a name.

## 11. Deploy and rollback

One VM deploy at a time. Nothing goes to main or the VM without the owner's word.

1. API + web (migration `0015`).
2. **Before any admission, the administrator sets the start number** in Yönetim › Protokol ve etiket. Until then every
   admission is refused (D5). The block says so in its first line.
3. Bridge rebuilt on the VM (the GHCR token on the VM is dead; built from the bundle).
4. The owner's NCE test session (§12, O1–O6).

**Rollback.** The bridge goes back to its previous image. The API goes back with a downgrade of `0015` and the
`:pre-g2b1d` tags. **Clean only before the first protocol admission:** after it, open admissions carry protocol-keyed
cards that an older API would not match, so from then on rollback means a forward fix. The block states this.

**Docs:**

- the Turkish guide (`docs/homunculus-rehber-TR.md`): protocol, label, device query;
- the roadmap row;
- `docs/EDGE-BRIDGE-LOCAL.md`: the API-first query and its counters;
- the B1a spec's §10 open item ("device shows the name for a kabul patient") marked closed by this slice.

## 12. Not in this slice / open items

**Not in this slice:**

- The permanent patient number and returning-person matching (D2).
- Outpatient visits and examinations, which would also open protocols.
- The HBYS program as a whole: its own roadmap, to be decomposed with the owner.
- Wristbands, allergy/DNR chips on the label, and direct ZPL printing.
- A barcode for H-numbers (Code 128-C cannot encode the `H`).
- Protocols for admissions already open.

**For the owner's NCE test session** (the owner tests these personally, 2026-11-01):

- **O1:** NCE Host1 still points at `172.100.101.72:2575`, and the feed is alive again. It has been silent since
  2026-09-05.
- **O2:** the Connex Spot scanner reads Code 128-C from the 50×30 label.
- **O3:** what the device shows on `NF`, and whether it lets the nurse save.
- **O4:** how the name appears (`PID-5` = `family^given`; a Homunculus admission has one name field, sent as given).
- **O5:** the queried value (QPD-3) is exactly the typed or scanned number, with no trailing `_`.
- **O6:** the Zebra driver has the 50×30 stock at 100 % scale, and the test label's bars print crisp.

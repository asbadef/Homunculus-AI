# Group 2 · Lane B — Monitor → bed mapping editor ("Monitör–yatak eşleme")

**Date** 2026-10-28 · **Status** approved in conversation section by section ("uygun", then "okudum
onayladim"), awaiting the user's read of this file · **Branch** `feat/g2b-monitor-esleme` from main
`12453ee` (worktree `/c/tmp/g2b-esleme`) · **Lane** B; per Lane A's decision (b), Lane A reviews every
hunk in its files (§7.1) · **Brief** `/c/tmp/homunculus-plans/next-slice-device-bed-editor.md` (the
request, Lane A's five constraints, Q1–Q3) · **Builds on** B1a
(`2026-10-25-g2b-kabul-taburcu-design.md`: Yapı, `GET /tenant/structure`, unit scope, stable codes,
migration 0012) and Aşama B (`2026-10-27-infinity-asama-b-golge-motor-design.md`: migration 0013, the
stage `rules`). Code references were read at `12453ee`.

## 1. What this slice delivers

Today a monitor sits on a bed only through a reviewed file, `deploy/infinity/device-beds.icu2.json`
(v2, sha256 `84ac1760d59f…`, 13 rows: 12 on Yapı beds `bed05…bed25` in «Reanimasiya», BED01 on none),
copied to the VM and re-read by `TableFile` every 10 s (`api/infinity_device_beds.py:303-331`). Every
change is a new file, a review and a VM job. The user asked (2026-10-26): "13 monitor tumunu bildirdim
suanda amma bunu sonradan kendimde gire biliyim duzenleme alani olsun workerden gelen bilgilere
iplere gore".

This slice:

- moves the mapping into a per-tenant database table, seeded once from the approved v2 file;
- puts an editor on the Monitörler screen: the administrator and the charge nurse bind a monitor the
  worker reports to a bed picked from Yapı, or unbind it, in two confirmed steps;
- keeps the one interface the strip and Aşama B read (`shadow_table.current()`), so nothing
  downstream changes;
- fixes two Yapı UX faults found in the B1a deploy.

## 2. Decisions

| # | Decision | Source and why |
|---|---|---|
| D1 | **The editor lives on the Monitörler screen**, as a list of monitors with «Yatağa bağla» / «Bağlantıyı çöz» beside each. No İdarə tab. | User, Q2 (2026-10-27): "monitorler ekraninda". The charge nurse needs no admin access. Where exactly: §3.1 and O1. |
| D2 | **Who may change the mapping:** a new permission `devices.map_beds`, granted by default to `hospital_admin` (by rule: the system group holds every key) and `charge_nurse`. A holder acts only on beds her unit scope reaches, enforced by the server. The administrator can grant the key to other groups in İdarə › Rollar. | User, Q1 (2026-10-27): "yonetici sorumlu hemsire" (the recommendation had been the administrator alone; the user chose both, so a charge nurse can fix a moved monitor at night). Not `devices.manage`: that key opens the research window and every unassigned device, and belongs by default to biomedical and the vendor's support group (`auth/permissions.py:44-49`). |
| D3 | **A target bed that already has a monitor:** the confirmation names both monitors. One transaction unbinds the old monitor and binds the new one. A bed never has two monitors, not even for a moment. | User, Q3 (2026-10-27): "eskini coz olarak onerdiyin". |
| D4 | **Two steps, the bed from the structure:** first pick, then confirm. A bed with an admitted patient asks for a SECOND explicit confirmation. This applies when binding to that bed, unbinding from it, or moving the monitor away from it. The server refuses such a change unless the request carries `confirm_occupied: true`. | Lane A C3; approved §1. The values start or stop flowing to a patient's card. |
| D5 | **The database is the source of truth.** A per-tenant table `device_beds` (migration **0014**). A change closes the current row (`valid_to`) and opens a new one. No row is ever deleted, and a trigger refuses deletes and edits. | Lane A C1; approved §2. |
| D6 | **One interface.** The strip and Aşama B keep reading `shadow_table.current()` → `TableState(table, status, reason, sha256, version)`, with the same `Row` fields (§5.3). In production the implementation is `PostgresDeviceBeds`. `TableFile` stays, but only for the lab (no Postgres) and for the one-time import. | Lane A C2. Aşama B's spec names the accessor (`2026-10-27-…-design.md:81`); its readers are `app.py:267`, `:1247` (the sampler pass) and `:1300` (the strip). |
| D7 | **Seed:** at deploy, a script imports the v2 file once, after checking its sha256 against the approved one. From then on the file is read-only history: nothing reads it in production, and its sha check goes. | Lane A C1; approved §2. |
| D8 | **Device identity comes from the worker**: IP, multicast group, port, status, last seen. It is never typed. A request may name only a device the API knows, either from the worker's reports or from a row. The group and port are taken from the worker, or from the device's last row. The central-station name (BED05…) is carried from v2 and never typed. | Lane A C4. The forwarder sends addresses only: "No device id or inventory name leaves the hub" (`edge/infinity_shadow.py:78-79`). |
| D9 | **Absent devices** stay in the list and stay bound, marked «görünmüyor · son görülme HH:MM». Nothing unbinds a device automatically. A new device the worker reports appears as unbound, and seeing it writes nothing. | Lane A C5; approved §1. |
| D10 | **Concurrent edits:** the request carries the rows the screen saw (`expected`), and the server checks them under row locks. A partial unique index is the last guard. The second editor gets `mapping_changed` ("changed meanwhile, refresh"), never a silent overwrite. | Approved §2. |
| D11 | **Audit:** `device_bed.bind`, `device_bed.unbind` and `device_bed.import`, each with the old and new rows and the actor. No patient. | Lane A C3; approved §2. |
| D12 | **Routes** `GET /infinity-shadow/device-beds`, `POST …/bind` and `POST …/unbind`, in a new Lane B router. | nginx already proxies `/infinity-shadow/` (`deploy/local/web/nginx.conf:143`), so no proxy or VM-config change is needed, and the routes sit beside the strip they change. The router uses B1a's guards (`require_permission`, `caller_tenant_id`, unit scope, `trail.record`, `Refusal`), which the board routes in `app.py` do not have. |
| D13 | **An unbind writes an unbound row**: it closes the bound row and opens one with no bed. It does not just close the row. | Spec's choice, for review. Every change then names its actor in the table, an absent unbound device keeps its identity in the list, and "no rows at all" stays the one meaning of a missing table (fail closed, §5.3). |
| D14 | **Two labels.** `device_bed_label` is what the central station calls the monitor (v2's `bed_label`; a property of the device, carried row to row). `bed_label` is the label the strip names the monitor's bed by, i.e. `Row.bed_label`. For v2 rows it is the file's label. For an editor row it is the target bed's Yapı label, copied at the bind and never typed. | Spec's choice, for review (O3). A monitor moved from bed08 to bed12 must not keep reading «BED08» on the strip, and the list still shows the central station's name. |
| D15 | **The editor works only while the strip runs for this hospital.** At stage `shadow` or `rules`, the caller's tenant must be `INFINITY_SHADOW_HOSPITAL`. Otherwise the routes answer `monitor_lane_off`. | Spec's choice. This mirrors `GET /infinity-shadow/board` (`app.py:1285-1291`). With the stage off there are no worker reports and no lane hospital. |
| D16 | **Two Yapı fixes in this slice.** First, a held «Çarpayı əlavə et» says why. Second, the room adder's boxes carry visible labels and a hint that beds are added under the room. | Approved §3. These are B1a deploy lessons (brief, "State at slice start"). |
| D17 | **Four languages** (az default, tr, en, ru). No UUID on any screen. Keyboard and screen reader supported throughout. | Approved §1. |

**Lane A's binding constraints, and where this spec meets them**

| # | Constraint (brief) | Met by |
|---|---|---|
| C1 | The database is the source of truth: per-tenant `device_beds` with `source, group, port, ip, device_bed_label, bed_id, unit_id, valid_from, valid_to, approved_by, approved_at`. v2 seeds it and is the last file version; the file becomes read-only history and its sha check goes. | D5, D7, §5.1, §5.4. Column notes are in O2. |
| C2 | One interface: `table.current()` returns rows with the same field names plus `bed_id`/`unit_id`. One implementation is swapped behind it. | D6, §5.3, and the parity test (§6). |
| C3 | Safety: the bed comes from the structure, never typed. Two steps (pick, then confirm), and the confirmation names the bed and the patient on it. The change takes effect only on confirm. Audited with old and new rows. A second confirmation for an admitted patient. History kept through `valid_from`/`valid_to`. | D4, D11, §3.3, §4.4, §4.7. How the patient is named: O5. |
| C4 | Device identity comes from the worker's discovery (IP, port, group, last seen), never typed. | D8, §4.4 step 2. |
| C5 | A device the worker no longer sees keeps its row and is marked absent, never unmapped automatically. | D9, §3.2. |

## 3. Screen

### 3.1 Where

The Monitörler screen is the rail entry «Monitörler» at `/devices`
(`dashboard/src/live/screens/devices/DevicesScreen.jsx`; route `shell/routes.js:77-80`). Today it opens
for `devices.manage` alone. Its `perms` become `["devices.manage", "devices.map_beds"]`, so a charge
nurse reaches it from the rail. The screen gains a section, **«Monitör–yatak eşleme»** (the list
below), above the strips it already shows.

Screen words in this spec are the approved Turkish ones. The az text (the default), and the en and
ru texts, are written in the plan.

The strip section is unchanged and still reads `GET /infinity-shadow/board`, whatever that route
answers for the session:
- a charge nurse holds `board.view`, so she sees her units' monitor cards, with the patient link
  dropped by the screen as today (`DevicesScreen.jsx:22-23`);
- a session with neither `board.view` nor `devices.manage` gets the strip's "unreadable" note, while
  the mapping section works.

The brief's phrase "Yataklar › Monitörler" is an open question; see O1.

### 3.2 The list

The section is shown to holders of `devices.map_beds` or `devices.manage`. It is read from
`GET /infinity-shadow/device-beds` (§4.2), every `POLL_MS` (5 s, as the strip:
`data/shadowStore.js:21`) while on screen, and again right after each change. It is a `Table` with
a caption. There is one row per monitor, ordered by address:

| Column | Content |
|---|---|
| Monitor | IP and port (`10.10.203.37 · 2050`), with the group in muted text. |
| Merkezi istasyon adı | `device_bed_label` (`BED08`), or «—» when the device never had one. |
| Görünürlük | «görünüyor» while the worker reports it. Otherwise «görünmüyor · son görülme 13:42» in the hospital's local time, or «görünmüyor · son görülme bilinmiyor» when this API process has not seen it since it started (O6). |
| Yatak | «bed08 · Otaq 08 · Reanimasiya» (the B1a form, `data/structure.js:51-53`), from the names the route returns. «bağlı değil» when unbound. «başka birimde» when the bound bed is outside the caller's units. |
| (actions) | Shown only when the device is `editable`: «Yatağa bağla» (when bound, «Başka yatağa bağla»), plus «Bağlantıyı çöz» when bound. |

Which rows appear:
- **New devices.** A monitor the worker reports and the table has never held appears as «bağlı değil»
  (D9).
- **Absent devices.** An absent bound monitor stays as it was, with its bed (D9).
- **No patient anywhere in the list.** The one exception is the occupied-bed dialog (§3.3).

### 3.3 «Yatağa bağla»

1. **Pick.** A `Modal` (as `screens/kabul/DischargeDialog.jsx`) opens with the caller's beds from
   `StructureProvider` (`GET /tenant/structure`, already limited to her units), grouped by unit and
   room, as a radio group:
   - closed beds, rooms and units are dimmed with the reason and cannot be picked;
   - each bed shows the monitor already on it («monitör: 10.10.203.24 (BED11)») and «dolu» when the
     structure's state is `OCCUPIED` / `PENDING_*`.
2. **Confirm.** One sentence names the monitor and the bed: «10.10.203.37 (BED08) → bed08 · Otaq 08 ·
   Reanimasiya».
   - If the bed has another monitor, a second sentence names it and says it will be unbound
     («10.10.203.24 (BED11) bu yataktan ayrılacak»).
   - If the device is bound elsewhere, a sentence names the bed it leaves.
3. **Second confirmation (an admitted patient).** This step appears when the target bed, or the bed
   the monitor leaves, holds an admitted patient. It is its own step with its own button. Its initial
   focus is on «Vazgeç», so that Enter cannot confirm it by accident. It says that the monitor's
   values will flow to (or stop flowing to) that patient's card. It names the patient by the board
   id, and by the name the bed card shows when the session's board holds that card (O5).
   - The screen knows to show this step from the structure state and the board.
   - If it did not know, and the server answers `bed_occupied` (a patient admitted meanwhile, or a
     HIS-fed patient), the step opens then, with the ids from the refusal.
4. **Done.** Nothing changes until the last confirm. The request is sent once, and the result is said
   on screen and in a toast («bağlandı»). The list reloads, and the strip shows the change at its
   next poll (≤ 5 s).

### 3.4 «Bağlantıyı çöz»

One confirm names the monitor and the bed. A patient on the bed adds the second confirmation of
§3.3 step 3, which then reads "values will stop flowing to this patient's card". The device then
reads «bağlı değil» in the list. On the strip it becomes «atanmamış cihaz» (D13).

### 3.5 Refusals on screen

Every refusal is mapped by its code (`live/apiErrors.js`, `ADMISSION_CODE_KEYS`), never by its words:

- `mapping_changed`: the dialog closes, the list reloads, and the screen says «Bu arada değişti —
  liste yenilendi; yeniden bakın».
- `out_of_scope`, `bed_closed`, `device_unknown`, `monitor_lane_off`: each has its sentence.

### 3.6 Rules the screen keeps

These are the rules of B1a §5.7:
- four languages (az default), Gece/Gün, 390 and 1440 px;
- results said on screen as well as in a toast;
- no raw key and no UUID;
- keyboard and screen reader:
  - each action's accessible name includes the monitor («Yatağa bağla: 10.10.203.37 (BED08)»);
  - `Modal` traps focus, Esc cancels, and focus returns to the invoking button;
  - outcomes are announced (`Announce`).

New strings go in `i18n/strings/monitor.js` (namespace `monitor.map.*`), plus `monitor.method.editor`
for the strip's method line (§5.3).

### 3.7 Yönetim › Yapı fixes (`screens/admin/StructureTab.jsx`)

1. **A held add button says why.** Today `Line` (`StructureTab.jsx:54-82`) keeps its button
   `aria-disabled` while the box is blank. The reason sentence is `sr-only` until the button is
   pressed, and a button that looks disabled is rarely pressed: «Çarpayı əlavə et» stood dimmed and
   the user believed the beds were added.
   - From now on, the blank-reason sentence is visible (muted) whenever the button is held because
     the box is blank, and turns to the error style after a press.
   - This is fixed in `Line`, so every adder and rename box gets it.
2. **The room adder cannot be mistaken for the bed adder.** `RoomAdd` (`StructureTab.jsx:106-133`)
   shows two bare boxes («Otaq adı», «Otaq nömrəsi»), and the bed label was typed into the number box.
   - Both boxes get visible labels; the number's says it is optional and gives an example.
   - A hint under the adder says that beds are added under the room once it exists, at «Çarpayı
     əlavə et».
   - Four languages; the words are in the plan.

## 4. Backend

### 4.1 Routes

A new router, `homunculus/devicebeds/router.py`, is mounted in `api/app.py` and reaches the shadow lane
through `request.app.state`.

| Method and path | Guard | Purpose |
|---|---|---|
| `GET /infinity-shadow/device-beds` | `require_permission("devices.manage", "devices.map_beds")` + `caller_tenant_id` | The list (§4.2). |
| `POST /infinity-shadow/device-beds/bind` | `require_permission("devices.map_beds")` + `caller_tenant_id` | Bind, move or replace (§4.3, §4.4). |
| `POST /infinity-shadow/device-beds/unbind` | `require_permission("devices.map_beds")` + `caller_tenant_id` | Unbind (§4.3, §4.4). |

Who can call them, and when:
- **People only.** A tenant token (a machine) gets 401: `require_permission` resolves a JWT
  principal, MFA included where the group requires it.
- **Only the strip's hospital.** All three answer 409 `monitor_lane_off` unless the strip runs
  (stage `shadow` or `rules`) and the caller's tenant slug (`trail.hospital_of`) is
  `INFINITY_SHADOW_HOSPITAL` (D15).

`GET /tenant/structure` also accepts `devices.map_beds` (`tenant/router.py:379-385`), so the picker
works for any group the administrator gives the key. The dashboard's `STRUCTURE_PERMS`
(`data/StructureProvider.jsx:40`) changes with it.

### 4.2 `GET /infinity-shadow/device-beds`

```json
{
  "stage": "shadow",
  "generated_at": "2026-10-28T09:12:03.120000+00:00",
  "can_bind": true,
  "devices": [
    {
      "source": "10.10.203.37", "group": "224.0.2.37", "port": 2050,
      "device_bed_label": "BED08",
      "seen": true, "status": "streaming", "last_seen_at": "2026-10-28T09:12:01.400000+00:00",
      "row_id": 12,
      "bed": {"id": "de98c201-…", "in_scope": true, "label": "bed08", "room": "Otaq 08", "unit": "Reanimasiya"},
      "editable": true
    }
  ]
}
```

What the list contains:
- **The devices.** The union of what the worker reports (`shadow_store.devices(now)`) and the
  tenant's current rows (`valid_to IS NULL`), ordered by address.
- **Live fields.** From the store: `status`, the shown status (`infinity_shadow.py:143-144`; `unknown`
  once unreported for 15 s, `:354`). `seen`: the status is neither null nor `unknown`.
  `last_seen_at`: the wall time of the device's last report (now − `status_age_s`), or null when this
  process has not held the device since it started. The store keeps a device until restart
  (`infinity_shadow.py:333-334`, `:346-364`).
- **Identity fields.** From the worker when it reports the device, else from its current row.
- **`row_id`.** The current row's id, or null when the table holds none for the device. It is the
  token `expected` sends back (§4.3).
- **`bed`.** null when unbound, including a v2 row like BED01 that has a label but no `bed_id`.
  Names are given only for a bed the caller's scope reaches; otherwise `{"id", "in_scope": false}`
  without names. A holder of `structure.manage` or an unrestricted scope gets every name, as with
  `GET /tenant/structure` (`tenant/router.py:388-397`).
- **`editable`.** True when the caller holds `devices.map_beds` and the device is unbound or its bed
  is `in_scope`.

### 4.3 Bind and unbind: request and response

```json
POST /infinity-shadow/device-beds/bind
{"source": "10.10.203.37", "bed_id": "de98c201-…",
 "expected": {"device_row_id": 12, "bed_row_id": null},
 "confirm_occupied": false}

POST /infinity-shadow/device-beds/unbind
{"source": "10.10.203.37", "expected": {"device_row_id": 12}, "confirm_occupied": false}
```

- `expected.device_row_id` is the device's `row_id` as the screen last saw it (null for a device with
  no row).
- `expected.bed_row_id` (bind only) is the `row_id` of the device the screen showed on the target bed,
  or null when it showed none.
- Both keys are required, and null is an explicit value. `confirm_occupied` defaults to false.
- Request models use `extra="forbid"`, as B1a's (`admission/schemas.py:10`). A shape error is FastAPI's
  422. A well-formed wrong value is `field_invalid:<field>`.

The response is 200 for both routes:

```json
{"changed": true, "replaced_source": "10.10.203.24", "list": { "...": "the GET body, after the change" }}
```

`changed: false` means the request asked for what already holds: a bind to the device's own bed, or
an unbind of an unbound device. It writes no row and no audit.

### 4.4 The transaction

This is one database transaction on the request's `AsyncSession`, with B1a's lock rules (A-26):
`FOR NO KEY UPDATE`, i.e. `with_for_update(key_share=True)`, and a bed locked before any row pointing
at it is written (`tenant/router.py:115-128`). `t` is taken once (UTC) and used for every
`valid_to`/`valid_from`/`approved_at` of the change.

1. **Lane and tenant (D15).** Otherwise `monitor_lane_off`.
2. **The device.** It must be reported by the worker or hold a row in this tenant's table; otherwise
   404 `device_unknown` (D8). `source` must be a unicast IPv4 (`unicast_ipv4`); otherwise
   `field_invalid:source`.
3. **The target bed (bind).**
   - It must be this tenant's: `scope.ensure_owned(tenant_of_bed(...))`. A missing bed and another
     tenant's get the same 404, as B1a.
   - The bed, its room and its unit must be open; otherwise `bed_closed`.
4. **Read the device's current row** without a lock, to learn its current bed.
5. **Lock the beds** touched (the target bed, the device's current bed) in ascending id order with
   `_lock_bed`'s strength. Two concurrent binds over the same two beds therefore queue and never
   deadlock.
6. **Lock the current rows** involved: the device's row and the target bed's bound row,
   `SELECT … FOR UPDATE`, in id order. Compare their ids with `expected`. Any difference, including a
   device whose bed moved between steps 4 and 6, gives 409 `mapping_changed`.
7. **Unit scope.** `unitscope.require_reach` must pass for the target bed and for the device's
   current bed; otherwise 403 `out_of_scope`. A charge nurse can therefore neither move a monitor out
   of another unit nor take one from it.
8. **Occupancy.** A bed is occupied when either check finds a patient:
   - **(a)** an open admission holds it: `_holds_open_admission`, `tenant/router.py:612`, read under
     the bed lock;
   - **(b)** the board's admitted patients on it: a fresh, uncached read through the same rule as the
     strip's `_occupants` (`app.py:1170-1195`), handed to the router as `app.state.bed_occupants`;
     this covers HIS-fed records.

   If the target bed or the bed the device leaves is occupied and `confirm_occupied` is not true, the
   answer is 409 `bed_occupied` with `occupied: [{"bed_id", "patient_id"?}]`, where:
   - the target bed comes first;
   - `patient_id` is the board's id (for an admission made here, its patient number);
   - `patient_id` is sent only to a caller holding `board.view`, so a key-only holder learns that a
     patient is there, not who.
9. **Write. All closes come first, then all inserts**, so the partial unique indexes never see two
   current rows:
   - close (`valid_to = t`) the device's current row, if any;
   - close the target bed's bound row, if it belongs to another device;
   - insert an unbound row for that displaced device (D3, D13);
   - insert the device's new row: bound (bind) or unbound (unbind).

   Each new row's content is given in §5.3. An `IntegrityError` from the partial unique indexes (two
   first binds of a new device racing, a writer outside these routes) is answered `mapping_changed`,
   never 500.
10. **Commit.**
11. **Invalidate** the accessor (`app.state.shadow_table_reset()`), so the next `current()` re-reads.
12. **Audit rows** (§4.7) through `trail.record`, which never raises (A-26).
13. **Answer** with the fresh list.

### 4.5 Stable codes

The codes are added to `admission/errors.py` `CODES`, the one registry `apiErrors.test.js` reads:

| Status | Code | When | Extra |
|---|---|---|---|
| 409 | `monitor_lane_off` (new) | The strip is off, or the caller's tenant is not the lane's hospital. | — |
| 404 | `device_unknown` (new) | `source` is neither reported by the worker nor in the tenant's table. | — |
| 409 | `bed_occupied` (new) | An admitted patient is on the target bed or the bed the device leaves, and `confirm_occupied` is not true. | `occupied: [{bed_id, patient_id?}]` |
| 409 | `mapping_changed` (new) | `expected` ≠ the current rows, or a partial unique index fired. | — |
| 403 | `out_of_scope` (B1a) | The target bed, or the device's current bed, is outside the caller's units. | — |
| 409 | `bed_closed` (B1a) | The target bed, its room or its unit is closed. | — |
| 422 | `field_invalid:source` / `:bed_id` / `:expected` (B1a form) | A well-formed body with a wrong value. | — |

A bed that is missing or belongs to another tenant answers 404 exactly as B1a's bed routes do. A
missing permission is `require_permission`'s 403.

### 4.6 Permission

- **The key.** `devices.map_beds` is added to `PERMISSIONS` (`auth/permissions.py:19-56`) with the
  description "Bind a bedside monitor to a bed, or unbind it, on the Monitörler screen — beds in one's
  own units only; a bed with an admitted patient asks a second confirmation".
- **Default groups.** It is added to `charge_nurse` in `DEFAULT_GROUPS` (`:144-150`). The system group
  holds it by rule (`:125-131`).
- **Existing tenants.** Migration 0014 adds it to every tenant's `charge_nurse` group (§5.1), as 0012
  did for `beds.release`.
- **Dashboard and tests.** Its mirror: `screens/admin/catalogue.js` (+ `catalogue.test.js` parity),
  `i18n/strings/perms.js` in four languages, `screens/admin/admin.testutil.js`.

### 4.7 Audit

Rows are written after the commit, under the tenant's slug, with `subject` = the monitor's address
and `patient_id` = "" (never a patient: approved §2, "No patient name"). Each device's change is its
own row (B1a A-4, "two changes, two rows").

- **`device_bed.bind`:**
  - `source`, `group`, `device_bed_label`;
  - `old` (null, or `{row_id, bed_id, unit_id, bed_label}` of the closed row);
  - `new` (`{row_id, bed_id, unit_id, bed_label}`);
  - `replaced_source` (or null);
  - `occupied_confirmed` (bool);
  - `actor` (the username).
- **`device_bed.unbind`:**
  - the same keys, with `new` being the unbound row;
  - `reason`: `unbound` (the route) or `replaced` (the displaced monitor of a bind, with
    `by_source`).
- **`device_bed.import`:**
  - `file_sha256`, `file_version`, `site`;
  - `rows`, `with_bed`, `without_bed`;
  - `actor: "import"`.

`rehydrate` ignores these kinds: it replays `ingest`, `chart`, `profile`, `ack`, `first_seen` and the
discharge rows only (`api/rehydrate.py:41-59`).

### 4.8 What a change does downstream (nothing new in Lane A's code)

- **The strip.** `board_view` reads the row valid now per device (`infinity_shadow.py:502-524`). After
  the invalidate, the next `GET /infinity-shadow/board` places the monitor on its new bed, or among the
  unassigned devices.
- **Aşama B, at the next forwarder body (~5 s).** The bed card's `link: one` starts, moves or ends the
  patient's link exactly as Aşama B D5 specifies (`infinity_rules.py:539-590`):
  - a moved monitor starts from now, keeping its own samples (`:562`);
  - an ended link returns the patient to the real picture and closes their shadow findings
    (`unlinked`).
- **No duplication.** The editor writes no sample, no observation and no board frame of its own.

### 4.9 App wiring (Lane A files; §7.1)

`api/app.py`:
- `create_app(..., device_beds: DeviceBedSource | None = None)`, with
  `shadow_table = device_beds if device_beds is not None else TableFile(...)` (`:255`);
- `app.state.shadow_settings`, `app.state.shadow_clock`, `app.state.shadow_table_reset`
  (`shadow_table.invalidate`) and `app.state.bed_occupants`. The last is the uncached per-bed read;
  `_occupants` and it share one helper, so the two cannot drift;
- `app.include_router(...)`.

`api/prodserver.py`: in production (a Postgres `DATABASE_URL`), it passes `PostgresDeviceBeds(url,
hospital=_shadow.hospital, ssl_required=…)` as `_samples` does (`prodserver.py:471-482`).

## 5. Data

### 5.1 Migration `0014_device_beds` (follows 0013)

The table:

```
device_beds
  id               bigserial PRIMARY KEY             -- row_id; `expected` carries it
  tenant_id        uuid NOT NULL REFERENCES tenants(id)
  source           varchar(45) NOT NULL              -- the monitor's unicast IPv4  (Row.source)
  group_address    varchar(45) NOT NULL              -- its multicast group        (Row.group)
  port             integer NOT NULL                  -- 2050                       (Row.port)
  device_bed_label varchar(32) NULL                  -- the central station's name for the monitor (D14)
  bed_label        varchar(50) NULL                  -- the strip's bed label      (Row.bed_label); NULL = unbound
  bed_id           uuid NULL REFERENCES beds(id)     -- (Row.bed_id, as text)
  unit_id          uuid NULL REFERENCES units(id)    -- (Row.unit_id, as text)
  method           varchar(32) NULL                  -- central_station_list | monitor_screen | both | editor
  verified_at      date NULL                         -- (Row.verified_at, YYYY-MM-DD)
  note             varchar(500) NULL                 -- v2's notes; NULL on every editor row
  valid_from       timestamptz NOT NULL
  valid_to         timestamptz NULL                  -- exclusive; NULL = current
  approved_by      varchar(128) NOT NULL             -- the actor's username; v2's approver for seeded rows
  approved_at      timestamptz NOT NULL
```

Constraints and indexes:
- `ck_device_beds_interval`: `valid_to IS NULL OR valid_to > valid_from`.
- `ck_device_beds_bed_unit`: `(bed_id IS NULL) = (unit_id IS NULL)`.
- `ck_device_beds_bound_label`: `bed_id IS NULL OR bed_label IS NOT NULL` (a bound row names its bed).
- `uq_device_beds_current_source`: UNIQUE `(tenant_id, source)` WHERE `valid_to IS NULL`. One current
  row per device.
- `uq_device_beds_current_bed`: UNIQUE `(tenant_id, bed_id)` WHERE `valid_to IS NULL AND bed_id IS
  NOT NULL`. One current monitor per bed. With step 9's order, a bed never has two, even inside the
  replace.
- `ix_device_beds_tenant_source`: `(tenant_id, source, valid_from)`, for history reads.
- **History kept** (D5): the function `device_beds_history_kept()` and the triggers
  `device_beds_no_delete` (BEFORE DELETE: raise) and `device_beds_close_only` (BEFORE UPDATE: raise
  unless `OLD.valid_to IS NULL`, `NEW.valid_to IS NOT NULL` and every other column is unchanged).
  This follows the pattern of 0004's `audit_is_append_only()` (`0004_audit_log.py:64-80`).
- **Data:** `INSERT INTO group_permissions (group_id, permission) SELECT id, 'devices.map_beds' FROM
  groups WHERE slug = 'charge_nurse' ON CONFLICT DO NOTHING`, as 0012 did (`0012_admission_kabul.py:183-188`).

One statement per `op.execute` (asyncpg; see 0004, 0010, 0013).

**Downgrade** removes, in this order:
1. the `devices.map_beds` rows (any group's);
2. the triggers and the function;
3. the indexes;
4. the table, with every mapping and its history.

Back up first. After a downgrade the old code reads the file again; §7.3.

### 5.2 ORM model

`homunculus/devicebeds/models.py` `DeviceBed` (on `Base`) is used by the router's writes. Its column
types must equal the migration's, which the whole-schema type test checks (pattern of
`tests/test_migration_0010_schema_parity.py`).

### 5.3 The accessor contract

**Interface.** `api/infinity_device_beds.py` (Lane A's file, which stays import-pure:
`tests/test_infinity_shadow_isolation.py:50-54`, `:154-160`) gains:

```python
class DeviceBedSource(Protocol):
    def current(self, now: float | None = None) -> TableState: ...   # `now`: monotonic s, as TableFile
    def invalidate(self) -> None: ...                                  # the next current() re-reads
```

It also gains:
- `TableFile.invalidate()`;
- `rows_digest(rows) -> str`: the SHA-256 of the rows' canonical JSON (sorted keys, `,`/`:`
  separators, UTF-8);
- `check_current(rows)`: one current row per source; one current bound row per `bed_id`; a bound row
  has a `bed_label`.

`check_current` deliberately does NOT apply the file's label rule `_same_bed`. That rule would refuse
the whole table, and put every monitor off its bed, if a Yapı label happened to equal a label-only
row's (BED01). Beds are told apart by `bed_id`, as `board_view` does (`infinity_shadow.py:500-506`).

**Implementation.** `api/device_beds_postgres.py` (new) holds `PostgresDeviceBeds(url, *, hospital,
clock=time.monotonic, ssl_required=False)`:
- a sync engine like `PostgresSamples` (`to_sync_url`, `pool_pre_ping`, `hide_parameters=True` per
  Aşama B D12);
- in its own module, because importing the audit's helpers from the lane module would break the
  isolation test's transitive check.

`current()` behaves as follows:
- It re-reads at most every `RELOAD_EVERY_S` (10 s, `infinity_device_beds.py:45`), and on the first
  call after `invalidate()`.
- **The read.** One query: the tenant's (by slug) rows with `valid_to IS NULL OR valid_to > :now`,
  where `:now` is the API's wall clock (the clock `board_view` resolves rows at), ordered by id, plus
  the tenant's row count and name. History stays in the table and is not loaded.
- **The answer** is a `TableState`:

  | Field | Value |
  |---|---|
  | `status` | `ok`; `missing` (the tenant has no rows: "eşleme tablosunda bu hastane için satır yok"); or `invalid` (the database unreadable: "eşleme tablosu okunamadı", or a `check_current` violation, naming it). |
  | `table` | `DeviceBedTable(version, site, approved_by, approved_at, rows)`. |
  | `version` | The tenant's row count, history included. It only grows, since nothing is deleted; it is 13 after the import. |
  | `sha256` | `rows_digest` of the loaded rows. |
  | `site` | The tenant's name. |
  | `approved_by`, `approved_at` | The newest row's, with `approved_at` as `YYYY-MM-DD` (UTC). |

- **Fail closed.** `missing` and `invalid` place no monitor on any bed, exactly as a missing or broken
  file does (`infinity_device_beds.py:12-13`). Aşama B's pass then skips (`app.py:1249-1252`), and a
  change of state is logged once, as `_announce` does.
- **Cost.** Called synchronously on the loop, like the identity store's reads. It costs one small
  query per 10 s.

**Row mapping** (`Row` fields unchanged, `infinity_device_beds.py:59-71`):

| `Row` field | Column | Seeded (v2) | Editor bind | Editor unbind / displaced |
|---|---|---|---|---|
| `source` | `source` | file | the device | the device |
| `group` | `group_address` | file | the worker's, else the last row's | the same |
| `port` | `port` | 2050 | 2050 | 2050 |
| `bed_label` | `bed_label` | file's `bed_label` | the target bed's `beds.label`, copied under the lock | NULL |
| `bed_id`, `unit_id` | same | file | the bed, and its room's unit (read, never from the body) | NULL |
| `method` | `method` | file | `editor` | `editor` |
| `verified_at` | `verified_at` | file | the date of `t` (UTC) | NULL |
| `note` | `note` | file | NULL | NULL |
| `valid_from`, `valid_to` | same | file | `t`, NULL | `t`, NULL |
| — | `device_bed_label` | file's `bed_label` | carried from the device's last row | carried |
| — | `approved_by`, `approved_at` | file's approver, the file date at 00:00Z | actor, `t` | actor, `t` |

`method: editor` reaches the strip's card (`board_view` copies `method` and `verified_at`,
`infinity_shadow.py:525-526`). The dashboard gains `monitor.method.editor` so `DevicesScreen.jsx:34`
prints no raw key (O9).

### 5.4 The seed import — `homunculus-engine/scripts/import_device_beds.py`

This is a script, not data inside the migration: the migration runs on every database, including the
lab and the tests. Its arguments are `--file` (default `/etc/homunculus/infinity-shadow/device-beds.json`),
`--tenant` (default `INFINITY_SHADOW_HOSPITAL`) and `--dry-run`.

1. **Read and check the sha.** Read the file capped (`read_capped`) and refuse unless its sha256
   equals `APPROVED_V2_SHA256 = "84ac1760d59f31b9ab016ca30f08cb1e7387addb02355ea02e3600e4e7ed584d"`.
   A test pins that constant to the committed file.
2. **Parse** with Lane A's own reader (`TableFile`/`parse_table`); the status must be `ok`.
3. **Check the beds.** In one transaction, refuse if the tenant already holds any `device_beds` row
   (no second import). Every `bed_id` must be a bed of this tenant, and every `unit_id` must be that
   bed's room's unit.
4. **Insert** the rows in file order, per §5.3, and commit.
5. **Audit.** Write `device_bed.import` through the Postgres audit log. Concurrent appends are safe:
   `audit_postgres.py:54-60`.
6. **Print** one line, `ESLEME_ICE_AKTARIM {"tenant","file_sha256","rows","with_bed","without_bed",
   "version","sha256"}`, where `version` and `sha256` are the values the accessor will report.

Exit codes:
- 0: imported;
- 2: refused (sha, parse, bed or unit check), nothing written;
- 3: already imported, nothing written.

`--dry-run` runs every check and writes nothing.

The file itself is never edited. It stays on the VM and in the repo as read-only history, and
`test_the_committed_site_table_is_approved_and_puts_every_monitor_on_its_own_bed`
(`tests/test_infinity_device_beds.py:341`) keeps pinning it.

## 6. Tests

TDD, red first, with Postgres where the code needs it (`TEST_DATABASE_URL`).

- **Parity** (`tests/test_device_beds_parity.py`). This is the C2 proof. Fixture: a tenant whose one
  unit and twelve beds carry v2's UUIDs.
  - `TableFile(icu2).current()` = F (`ok`). After the import, `PostgresDeviceBeds(...).current()` = D
    (`ok`).
  - `D.table.rows == F.table.rows`: every `Row` field, in order.
  - `D.table.at(s, t) == F.table.at(s, t)` for every source and for t ∈ {valid_from − 1 s,
    valid_from, now, a far future}.
  - `board_view` over one fixed set of `DeviceView`s gives identical `beds` and `unassigned`
    (`table` block aside). The set is the 13 sources plus one unknown, and the occupants are: one bed
    with one patient, one with two, the rest empty.
  - The import's audit row carries the file's sha and 13/12/1.
- **Import.** A wrong sha, an invalid file, a foreign or missing bed, and a wrong unit each refuse
  with exit 2 and write nothing. A second run gives exit 3. `--dry-run` writes nothing. The constant
  equals the committed file's sha256.
- **Accessor.**
  - `missing` and `invalid` place nothing;
  - the 10-s cache, and `invalidate()`;
  - only current rows are loaded;
  - `version` grows and `sha256` changes with each change;
  - `check_current` refuses each violation, and a label-only row whose label equals a Yapı bed's is
    NOT a violation;
  - the lane module stays import-pure (the existing isolation test, unchanged).
- **Routes** (`tests/test_device_beds_api.py`):
  - bind (new device, unbound, moved), unbind, replace (D3: one transaction, two audit rows, never two
    current rows on the bed), and `changed: false`;
  - occupied beds: refused without `confirm_occupied` and accepted with it, for a `kabul` admission
    (DB) and a HIS-fed occupant (identity store, via the bed map), on the target bed and on the bed a
    moved or unbound monitor leaves; `patient_id` only for `board.view`;
  - unit scope: a charge nurse granted unit U1 is refused (`out_of_scope`) a U2 bed, the move of a U2
    monitor, and the unbind of a U2 monitor; she sees U2 rows with `editable: false` and without
    names;
  - permission: a nurse gets 403 on all three; biomedical (`devices.manage`) can GET and gets 403 on
    the writes;
  - tenant isolation: another tenant's bed is the same 404 as a missing one; another tenant's caller
    gets `monitor_lane_off`. Listed in `test_tenant_isolation.py`;
  - `device_unknown`, `bed_closed`, `monitor_lane_off` (stage off; another hospital);
  - concurrency (two sessions):
    - a stale `expected` gives `mapping_changed`;
    - two binds racing over the same beds: one wins, one `mapping_changed`, no deadlock;
    - two first binds of a new device: the partial index decides, giving one `mapping_changed`;
  - audit rows: kinds, `old`/`new`, actor. The admitted patient's name appears nowhere in any new
    audit row. A failing audit store still answers 200 and logs (A-26);
  - downstream: after a bind, `GET /infinity-shadow/board` shows the monitor on its new bed at the
    next read. At stage `rules`, the next readings body links the bed's patient.
- **Route tables:**
  - `test_route_permissions.py`: three new routes (59 → 62), the new module in `GUARDED_MODULES`, and
    `GET /tenant/structure` with the new key;
  - `test_route_inventory.py` passes unchanged (JWT routes);
  - `test_nginx_routes.py`: the three paths;
  - `test_permissions.py` and `catalogue.test.js`: the catalogue.
- **Migration** (`tests/test_migration_0014_device_beds.py`):
  - 0013 → 0014 → 0013 → 0014 on the real chain;
  - the charge-nurse grant on an existing tenant;
  - the two partial indexes refuse a second current row per device and per bed, and allow closed
    history;
  - the trigger refuses DELETE and any UPDATE but a close;
  - model/migration type parity.
- **Dashboard:**
  - the list: columns; absent with and without last seen; «başka birimde»; editable gating;
  - the three dialogs: pick, confirm naming both monitors, the occupied step with focus on «Vazgeç»;
  - `bed_occupied` from the server opening the occupied step;
  - `mapping_changed` reloading the list;
  - the route's new `perms`; `STRUCTURE_PERMS`;
  - `apiErrors.test.js` (the four new codes mapped);
  - `strings.test.js` (parity; az ≠ tr); `rawKeys.test.jsx`; no UUID rendered;
  - the two Yapı fixes (`StructureTab.test.jsx`);
  - `vite build`.
- **Local walk** on a separate stack, with a synthetic structure and synthetic devices (no real
  data). In az, headless Chrome, at 390 and 1440 px:
  - import a synthetic table;
  - bind, replace, move and unbind, and see the strip follow;
  - the occupied-bed step;
  - a charge nurse's scope;
  - the Yapı fixes.

## 7. Deploy

### 7.1 Rollout and Lane A review

Branch `feat/g2b-monitor-esleme` from main `12453ee`; migration **0014**. Lane A reviews every hunk in:
- `api/infinity_device_beds.py` (the protocol, `TableFile.invalidate`, `rows_digest`, `check_current`);
- `api/device_beds_postgres.py` (what the strip and Aşama B now read);
- `api/app.py` (wiring, hooks, `_occupants` helper);
- `api/prodserver.py`;
- `api/infinity_shadow.py` (no change expected; any hunk there is Lane A's);
- `screens/devices/DevicesScreen.jsx` (Aşama A's screen);
- the new read-only summary script in `deploy/infinity/` (below).

Merge and deploy happen on the user's word, one deploy at a time across both lanes. The code ships as
a git bundle (the VM has no git credential).

### 7.2 Blocks the user pastes

Every `docker compose run|exec`, `psql` or `ssh` inside a pasted heredoc takes `</dev/null`. Each
block stops at its first error, and "durdum" means nothing changed.

1. **Dump and rollback tags:**
   - `pg_dump` of the database;
   - `docker tag` of the running api and web images as `:pre-esleme`;
   - `sha256sum` of the deployed `deploy/local/infinity-shadow/device-beds.json` must begin
     `84ac1760d59f` (stop otherwise);
   - the "before" summary of `GET /infinity-shadow/board` (tenant token, as
     `deploy/infinity/shadow_check.py` reads it), printed as `ESLEME_OZET_ONCE {...}`: the sorted
     `(source, bed_id, bed_label)` of every bed card, the sorted unassigned sources with reasons, the
     number of `link: one` cards, and `feed.devices.total`.
2. **Code and migration:**
   - fetch the bundle, check it out, and build the api and web images;
   - apply 0014 with the NEW image in a one-off container
     (`docker compose run --rm --no-deps api alembic upgrade head </dev/null`) while the old API keeps
     serving: 0014 adds a table, a trigger and one permission row, none of which the old code reads;
   - print `alembic current` = 0014;
   - run block 3 right after. While 0014 is applied under the old image, a restart of the old api
     container would stop at its own `alembic upgrade head` (`Dockerfile.api:51`), since it does not
     know 0014 (O11).
3. **Import with the sha check, then start:**
   - `docker compose run --rm --no-deps api python scripts/import_device_beds.py --tenant <slug> </dev/null`
     must print `ESLEME_ICE_AKTARIM` with 13 rows, 12 with a bed and 1 without (stop otherwise);
   - then `docker compose up -d api web` from block 2's images, and wait for health;
   - the import comes before the new API starts, so the strip never shows a missing table.
4. **Check:**
   - `ESLEME_OZET_SONRA` must equal block 1's for the bed cards, the unassigned devices and the
     `link: one` count. The block prints both and says so if an admission or discharge happened
     between;
   - the board's `table.status` is `ok` and `version` is 13;
   - the strip on screen looks as before.
5. **Live try on screen** (the administrator):
   - BED01 (`10.10.203.25`, the one monitor on no Yapı bed) → «Yatağa bağla» → an empty bed (no
     patient, no monitor) → confirm. The list and the strip show it there;
   - «Bağlantıyı çöz» → confirm;
   - then a read-only print of the two `device_bed.*` audit rows and of that source's three table rows
     (v2's closed, the bound one closed, the unbound one open);
   - the summary differs from block 4 by exactly BED01, which goes from a «BED01» card with no bed to
     «atanmamış cihaz» (O4).

### 7.3 Rollback

- **After block 2 only:**
  `docker compose run --rm --no-deps api alembic downgrade 0013 </dev/null`. Use the NEW image; the
  old one does not know 0014.
- **After block 3:**
  - the same downgrade, then the `:pre-esleme` images back and `up -d api web`;
  - the old code reads the file again, unchanged on disk;
  - mapping changes made since the deploy are lost from the table; the dump and the audit rows keep
    them.

### 7.4 Docs

- `deploy/infinity/README.md`: the table now lives in the database, the file is history, the import,
  the rollback.
- `deploy/local/.env.example`: `INFINITY_DEVICE_BEDS_PATH` is read only by the lab and the import.
- `docs/homunculus-rehber-TR.md`: «Monitör–yatak eşleme» for the ward — who, the two confirmations,
  what "görünmüyor" means.
- The roadmap row.

## 8. Not in this slice

These are the approved §3 exclusions:
- auto-suggesting the right bed;
- monitors on networks the worker cannot see (a worker setting);
- mobile;
- permanent device deletion.

This spec adds one more: editing the central-station name (`device_bed_label`), since identity is
never typed (C4).

## 9. Open items

- **O1 Where exactly.** The brief says "Monitörler screen (Yataklar › Monitörler)". The code has two
  candidates:
  - the rail screen «Monitörler» (`/devices`, `DevicesScreen.jsx`): every device and no patient;
  - on the Yataklar screen, the section «Monitörler — doğrulanmamış» (`BedsScreen.jsx:62`), which
    lists only monitors on no patient card, scoped.

  This spec uses the rail screen. The user's word was "ekran", and it is the screen that lists every
  device. The user should confirm.
- **O2 Column names (Lane A).** C1 lists both `source` and `ip`. In today's `Row`, `source` IS the
  IP, so the table keeps one column, `source`. `group` is an SQL reserved word, so the column is
  `group_address`, mapped back to `Row.group`. The table also carries `bed_label`, `method`,
  `verified_at` and `note`, because exact parity needs them. Lane A should confirm or rename at plan
  time.
- **O3 The strip's label for an editor row** is the Yapı label copied at the bind (D14). A later Yapı
  rename does not reach it until the next bind. A live join would follow renames, but would turn v2's
  «BED05» into «bed05» and break exact parity. Lane A and the user should confirm.
- **O4 BED01 after the live try.** Bind-then-unbind leaves it as «atanmamış cihaz» instead of v2's
  «BED01» card with no bed (D13). The choices are to:
  - (a) accept this;
  - (b) have an unbind keep the central-station name as the strip's label (U1: the device stays a
    card with no bed);
  - (c) try on another monitor (a rebind then shows the Yapı label, O3).

  The user decides before the deploy.
- **O5 Naming the patient in the second confirmation.** C3 asks the confirmation to name the patient.
  Aşama A's Decision 12 keeps patients off the device screen (`DevicesScreen.jsx:6-9`). This spec
  makes the dialog the one exception: the board id from the server (to `board.view` holders), and the
  name only from the session's own board card. Lane A should confirm.
- **O6 Last seen after an API restart** is in memory only. An absent device reads «son görülme
  bilinmiyor» until the worker reports it again. Persisting last seen is not in this slice.
- **O7 Closing a bed in Yapı while a monitor is bound to it** is neither refused nor unbound here; the
  list shows the binding. Decide later: refuse the close, or ask.
- **O8 A history view on screen.** The table and the audit hold every change, but no screen shows a
  monitor's history in this slice.
- **O9 `method: editor` and `verified_at` = the bind date** on the strip's method line (Lane A's
  wording).
- **O10 `version` and `sha256` change meaning** with the database source (row count; digest of the
  current rows). `shadow_check.py --table-version/--table-sha` keep working with the values the
  import prints. Whether to drop those flags is Lane A's call.
- **O11 Blocks 2 and 3 run back to back.** The old image cannot restart once 0014 is applied (§7.2).
- **O12 Native-speaker review** of the new az/ru/en texts, as for B1a.
- **O13 One lane hospital.** The table is per-tenant, but the lane reads one hospital
  (`INFINITY_SHADOW_HOSPITAL`); another tenant gets `monitor_lane_off` (D15).

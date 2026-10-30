# Group 2 · Lane B — Monitor → bed mapping editor ("Monitör–yatak eşleme")

**Date** 2026-10-28 · **Status** approved in conversation section by section ("uygun", then "okudum
onayladim"), awaiting the user's read of this file; amended 2026-10-30 (below) · **Branch**
`feat/g2b-monitor-esleme` from main `12453ee`, rebased onto main `cad9bea` (worktree `/c/tmp/g2b-esleme`) · **Lane** B; per Lane A's decision (b), Lane A reviews every
hunk in its files (§7.1) · **Brief** `/c/tmp/homunculus-plans/next-slice-device-bed-editor.md` (the
request, Lane A's five constraints, Q1–Q3) · **Builds on** B1a
(`2026-10-25-g2b-kabul-taburcu-design.md`: Yapı, `GET /tenant/structure`, unit scope, stable codes,
migration 0012) and Aşama B (`2026-10-27-infinity-asama-b-golge-motor-design.md`: migration 0013, the
stage `rules`). Code references were read at `12453ee`.

**Amended 2026-10-30** (before the plan): the branch was rebased onto main `cad9bea` (NBP-2), and every
reference into a file NBP-2 touched (`api/infinity_shadow.py`, `edge/infinity_shadow.py`,
`edge/infinity_live.py`, `deploy/infinity/shadow_check.py`, the dashboard's `MonitorStrip`/`monitor.js`)
was read again at `cad9bea` and corrected. The open items are resolved (§9): Lane A's answers (O2, O5,
O9, O10, O11) and the controller's calls (O1, O3, O4, O7) are folded into the sections they change —
§2 (D1, D2, D4, D7, D11, D14, and the new D18–D21), §3, §4, §5, §6 and §7.

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
| D1 | **The editor lives on the rail screen «Monitörler»** (`/devices`, `DevicesScreen.jsx`), as a list of monitors with «Yatağa bağla» / «Bağlantıyı çöz» beside each. No İdarə tab, and not the Yataklar screen's «Monitörler — doğrulanmamış» section. Final (O1). | User, Q2 (2026-10-27): "monitorler ekraninda", confirmed for the rail screen (O1, 2026-10-27). The charge nurse needs no admin access. §3.1. |
| D2 | **Who may change the mapping:** a new permission `devices.map_beds`, held by `hospital_admin` by rule (the system group holds every key at token issuance, `auth/groups.py:79-80`) and granted to `charge_nurse`: in `DEFAULT_GROUPS` for a new tenant, and for the lane hospital's existing group by the seed import's one-time grant step, never by migration 0014 (O11, §4.6). A holder acts only on beds her unit scope reaches, enforced by the server. The administrator can grant the key to other groups, or take it away, in İdarə › Rollar. | User, Q1 (2026-10-27): "yonetici sorumlu hemsire" (the recommendation had been the administrator alone; the user chose both, so a charge nurse can fix a moved monitor at night). Not `devices.manage`: that key opens the research window and every unassigned device, and belongs by default to biomedical and the vendor's support group (`auth/permissions.py:44-49`). |
| D3 | **A target bed that already has a monitor:** the confirmation names both monitors. One transaction unbinds the old monitor and binds the new one. A bed never has two monitors, not even for a moment. | User, Q3 (2026-10-27): "eskini coz olarak onerdiyin". |
| D4 | **Two steps, the bed from the structure:** first pick, then confirm. A bed with an admitted patient asks for a SECOND explicit confirmation. This applies when binding to that bed, unbinding from it, or moving the monitor away from it. The server refuses such a change unless the request carries `confirm_occupied: true`; the server decides, and its `bed_occupied` refusal is what opens the second step (§3.3). The second step names the patient only by the short name «Ahmet Y.» from the session's own board card (O5). | Lane A C3 and O5; approved §1. The values start or stop flowing to a patient's card. |
| D5 | **The database is the source of truth.** A per-tenant table `device_beds` (migration **0014**, purely additive: §5.1). A change closes the current row (`valid_to`) and opens a new one. No row is ever deleted, and a trigger refuses deletes and edits. | Lane A C1 and O11; approved §2. |
| D6 | **One interface.** The strip and Aşama B keep reading `shadow_table.current()` → `TableState(table, status, reason, sha256, version)`, with the same `Row` fields (§5.3). In production the implementation is `PostgresDeviceBeds`. `TableFile` stays, but only for the lab (no Postgres) and for the one-time import. | Lane A C2. Aşama B's spec names the accessor (`2026-10-27-…-design.md:81`); its readers are `app.py:267`, `:1247` (the sampler pass) and `:1300` (the strip). |
| D7 | **Seed:** at deploy, a script imports the v2 file once, after checking its sha256 against the approved one; in the same transaction it grants `devices.map_beds` to the tenant's `charge_nurse` group (O11). It prints the `version` and `sha256` the accessor will report (O10). From then on the file is read-only history: nothing reads it in production, and its sha check goes. | Lane A C1, O10, O11; approved §2. |
| D8 | **Device identity comes from the worker**: IP, multicast group, port, status, last seen. It is never typed. A request may name only a device the API knows, either from the worker's reports or from a row. The group and port are taken from the worker, or from the device's last row. The central-station name (BED05…) is carried from v2 and never typed. | Lane A C4. The forwarder sends addresses only: "No device id or inventory name leaves the hub" (`edge/infinity_shadow.py:102`, at `cad9bea`). |
| D9 | **Absent devices** stay in the list and stay bound, marked «görünmüyor · son görülme HH:MM». Nothing unbinds a device automatically. A new device the worker reports appears as unbound, and seeing it writes nothing. | Lane A C5; approved §1. |
| D10 | **Concurrent edits:** the request carries the rows the screen saw (`expected`), and the server checks them under row locks. A partial unique index is the last guard. The second editor gets `mapping_changed` ("changed meanwhile, refresh"), never a silent overwrite. | Approved §2. |
| D11 | **Audit:** `device_bed.bind`, `device_bed.unbind`, `device_bed.relabel` and `device_bed.import`, each with the old and new rows and the actor. A change confirmed on an occupied bed carries that patient's board id in the row's `patient_id`; no row ever carries a name (§4.7). | Lane A C3 and O5; approved §2. |
| D12 | **Routes** `GET /infinity-shadow/device-beds`, `POST …/bind` and `POST …/unbind`, in a new Lane B router. | nginx already proxies `/infinity-shadow/` (`deploy/local/web/nginx.conf:143`), so no proxy or VM-config change is needed, and the routes sit beside the strip they change. The router uses B1a's guards (`require_permission`, `caller_tenant_id`, unit scope, `trail.record`, `Refusal`), which the board routes in `app.py` do not have. |
| D13 | **An unbind writes an unbound row**: it closes the bound row and opens one with no bed. It does not just close the row. | Spec's choice, for review. Every change then names its actor in the table, an absent unbound device keeps its identity in the list, and "no rows at all" stays the one meaning of a missing table (fail closed, §5.3). |
| D14 | **Two labels.** `device_bed_label` is what the central station calls the monitor (v2's `bed_label`; a property of the device, carried row to row). `bed_label` is the label the strip names the monitor's bed by, i.e. `Row.bed_label`. For v2 rows it is the file's label («BED05»), kept until a rename or a rebind. For an editor row it is the target bed's Yapı label, copied at the bind and never typed. A Yapı rename of a bound bed relabels its current row in the rename's own transaction (D18), so the strip follows renames. | Spec's choice; O3 (controller, 2026-10-30). A monitor moved from bed08 to bed12 must not keep reading «BED08» on the strip, and the list still shows the central station's name. |
| D15 | **The editor works only while the strip runs for this hospital.** At stage `shadow` or `rules`, the caller's tenant must be `INFINITY_SHADOW_HOSPITAL`. Otherwise the routes answer `monitor_lane_off`. | Spec's choice. This mirrors `GET /infinity-shadow/board` (`app.py:1285-1291`). With the stage off there are no worker reports and no lane hospital. |
| D16 | **Two Yapı fixes in this slice.** First, a held «Çarpayı əlavə et» says why. Second, the room adder's boxes carry visible labels and a hint that beds are added under the room. | Approved §3. These are B1a deploy lessons (brief, "State at slice start"). |
| D17 | **Four languages** (az default, tr, en, ru). No UUID on any screen. Keyboard and screen reader supported throughout. | Approved §1. |
| D18 | **Yapı follows the mapping.** (a) A bed rename that changes the label closes the bed's current bound row (`valid_to` = t) and opens a new one: the same device and bed, the new label, `method: editor`; audited `device_bed.relabel`; in the rename's own transaction (O3). (b) Closing a bed (`is_active` → false) that has a monitor bound to it is refused `bed_has_monitor`; the screen sends the user to «Monitörler» to unbind first (O7). A room or a unit closes only once all its beds are closed, so (b) covers them. | O3, O7 (controller, 2026-10-30). §4.10. |
| D19 | **`version` and `sha256` from the database** (Lane A's rule): `version` = `max(id)` of the tenant's `device_beds` rows, history included; `sha256` = the SHA-256 of the canonical JSON of the CURRENT rows as `[source, bed_id, bed_label]` lists, sorted by source. The import prints both; the deploy blocks quote them to `shadow_check.py --table-version/--table-sha`, whose flags stay. | O10 (Lane A). §5.3. |
| D20 | **Migration 0014 is purely additive** and holds no data: a new table, its indexes, a function and two triggers. The `devices.map_beds` grant is the seed import's one-time step (D7). An image from before this slice can therefore serve against a database at 0014; only its start command refuses, and the blocks start it without its migration step (§7.3). | O11 (Lane A). §5.1, §7. |
| D21 | **An editor row's provenance:** `method: "editor"`, `verified_at` = the database time of the change (`t`, §4.4) in UTC ISO-8601, `verified_by` = the acting user's id. The import copies v2's `method` and `verified_at` per row unchanged (`verified_by` null). | O9 (Lane A wording). §5.3. |

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

The brief's phrase "Yataklar › Monitörler" is settled: the rail screen, not the Yataklar screen's
«Monitörler — doğrulanmamış» section (O1, final).

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
   values will flow to (or stop flowing to) that patient's card.
   - **The server decides.** The confirm of step 2 sends the request with `confirm_occupied: false`.
     When the server answers `bed_occupied` (§4.4 step 8: an open admission here, or an admitted
     patient the board puts on the bed, HIS-fed ones included), this step opens with the beds from
     the refusal; its confirm sends the same request again with `confirm_occupied: true`. The browser
     holds no occupancy rule of its own; the structure's «dolu» in the picker is information only.
   - **How the patient is named (O5).** Only by the short name, as in «Ahmet Y.»: the first word of
     the name and the initial of its last word, taken from the session's own board card for the
     `patient_id` the refusal carries (sent only to `board.view` holders). No number, no birth date,
     no id is printed. When the session has no such card (no `board.view`, or the card is not in its
     board), the step says that an admitted patient is on the bed, without a name. The server sends
     no name to this screen.
4. **Done.** Nothing changes until the last confirm. The result is said on screen and in a toast
   («bağlandı»). The list reloads, and the strip shows the change at its next poll (≤ 5 s).

### 3.4 «Bağlantıyı çöz»

One confirm names the monitor and the bed. A patient on the bed adds the second confirmation of
§3.3 step 3, which then reads "values will stop flowing to this patient's card". The device then
reads «bağlı değil» in the list. On the strip it becomes «atanmamış cihaz» (D13).

### 3.5 Refusals on screen

Every refusal is mapped by its code (`live/apiErrors.js`, `ADMISSION_CODE_KEYS`), never by its words:

- `mapping_changed`: the dialog closes, the list reloads, and the screen says «Bu arada değişti —
  liste yenilendi; yeniden bakın».
- `bed_occupied`: not a failure; it opens the second confirmation (§3.3 step 3).
- `out_of_scope`, `bed_closed`, `device_unknown`, `monitor_lane_off`: each has its sentence.
- `bed_has_monitor` is Yapı's (§3.7 item 3), not this screen's.

### 3.6 Rules the screen keeps

These are the rules of B1a §5.7:
- four languages (az default), Gece/Gün, 390 and 1440 px;
- results said on screen as well as in a toast;
- no raw key and no UUID;
- keyboard and screen reader:
  - each action's accessible name includes the monitor («Yatağa bağla: 10.10.203.37 (BED08)»);
  - `Modal` traps focus, Esc cancels, and focus returns to the invoking button;
  - outcomes are announced (`Announce`).

New strings go in a new namespace file, `i18n/strings/esleme.js` (keys `esleme.*`), so Lane A's
`strings/monitor.js` takes one key only: `monitor.method.editor`, for the strip's method line (§5.3).
That line (`DevicesScreen.jsx:34`) prints `verified_at` as it comes; an editor row's is a UTC
timestamp (D21), which the line prints as the hospital's local «YYYY-AA-GG SS:DD» (a v2 row's date
stays as it is). Both are hunks in Lane A's files (§7.1).

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
3. **A bed with a monitor cannot be closed (O7, D18 b).** The server refuses `bed_has_monitor`; the
   toast names the bed and says to unbind its monitor first on «Monitörler» («Bu yatağa bir monitör
   bağlı — önce «Monitörler» ekranında bağlantıyı çözün»). Four languages.

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
- **Live fields.** From the store: `status`, the shown status (`infinity_shadow.py:145-147`; `unknown`
  once unreported for 15 s, `:361`; references at `cad9bea`). `seen`: the status is neither null nor
  `unknown`. `last_seen_at`: the wall time of the device's last report (now − `status_age_s`), or null
  when this process has not held the device since it started. The store keeps a device until restart,
  or until more than 100 devices push out the least recently reported (`infinity_shadow.py:340-341`,
  `devices()` at `:353-371`).
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
an unbind of an unbound device. It writes no row and no audit. It is judged under the locks of §4.4
step 6, BEFORE `expected` is compared, so a request sent again after its answer was lost finds its
own change made and answers `changed: false` rather than `mapping_changed`. The routes carry no
`request_id` (the spec never had one): this rule and `expected` are their idempotency.

### 4.4 The transaction

This is one database transaction on the request's `AsyncSession`, with B1a's lock rules (A-26):
`FOR NO KEY UPDATE`, i.e. `with_for_update(key_share=True)`, and a bed locked before any row pointing
at it is written (`tenant/router.py:115-128`). `t` is the database's own clock, `clock_timestamp()`,
read once right after step 6's locks are held, in UTC; it is every `valid_to`/`valid_from`/
`approved_at` of the change and the new rows' `verified_at` (D21). Read after the locks, it is later
than the `valid_from` of any row the change closes (that row's transaction committed before the lock
was granted), so `ck_device_beds_interval` holds. It is the database's time of the change, the
transaction committing a few milliseconds later (O9).

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
   `SELECT … FOR UPDATE`, in id order. Re-read the target bed's, its room's and its unit's
   `is_active` under the bed lock (`bed_closed`, as step 3: a close may have committed meanwhile).
   If the request asks for what already holds, answer `changed: false` now (§4.3). Otherwise compare
   the rows' ids with `expected`; any difference, including a device whose bed moved between steps 4
   and 6, gives 409 `mapping_changed`. Then read `t`.
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
| 409 | `bed_has_monitor` (new) | `PATCH /tenant/beds/{id}` closes a bed (`is_active` → false) that has a monitor bound to it (D18 b, O7). | — |
| 403 | `out_of_scope` (B1a) | The target bed, or the device's current bed, is outside the caller's units. | — |
| 409 | `bed_closed` (B1a) | The target bed, its room or its unit is closed. | — |
| 422 | `field_invalid:source` / `:bed_id` / `:expected` (B1a form) | A well-formed body with a wrong value. | — |

A bed that is missing or belongs to another tenant answers 404 exactly as B1a's bed routes do. A
missing permission is `require_permission`'s 403.

### 4.6 Permission

- **The key.** `devices.map_beds` is added to `PERMISSIONS` (`auth/permissions.py:19-56`) with the
  description "Bind a bedside monitor to a bed, or unbind it, on the Monitörler screen — beds in one's
  own units only; a bed with an admitted patient asks a second confirmation".
- **Default groups.** It is added to `charge_nurse` in `DEFAULT_GROUPS` (`:144-150`), which a NEW
  tenant's groups are made from (`ensure_default_groups`, `auth/groups.py:44-62`, called at tenant
  creation, `tenant/router.py:222`, and by the boot seed, `auth/seed.py:146`).
- **The administrator** needs no row: the system group holds the whole catalogue BY RULE at token
  issuance (`auth/groups.py:79-80`; `admin/service.py:166-170` for the admin screen's own rights
  check), keys added after the tenant was seeded included — as every other key. Adding the key to
  `PERMISSIONS` is all it takes.
- **The lane hospital's existing `charge_nurse` group (O11).** Not in migration 0014. Until now an
  existing tenant got a new key from a migration (0012 inserted `beds.release`,
  `0012_admission_kabul.py:183-188`), because `ensure_default_groups` never adds a key to a group
  that exists (`auth/groups.py:51-52`). Here the grant is the seed import's one-time step (§5.4): in
  the import's transaction, `INSERT INTO group_permissions (group_id, permission) SELECT id,
  'devices.map_beds' FROM groups WHERE tenant_id = :tenant AND slug = 'charge_nurse' AND NOT is_system
  ON CONFLICT DO NOTHING`, recorded in the import's audit row. Not a step at every start: a boot-time
  grant would put the key back after an administrator took it away in Rollar. Other tenants are not
  granted: the routes answer them `monitor_lane_off` (D15), and an administrator can still grant the
  key in Rollar.
- **Safe both ways.** An image from before this slice, meeting `devices.map_beds` in
  `group_permissions`:
  - drops it from every token (`auth/groups.py:82-84`: the union is intersected with the catalogue,
    "so a key retired from the catalogue … never reaches a token") and from the admin screen's rights
    (`admin/service.py:170`, `:198`);
  - serves it as stored in `GET /admin/groups` (`served_permissions`, `admin/service.py:267-274`),
    and its dashboard reads a key its mirror lacks as retired: that group's Rollar column turns
    read-only and names the key (`RolesTab.jsx:49-52`, `rules.js:109-111`), so its `PATCH`, which
    would answer 422 for an unknown key (`admin/service.py:324-328`), is never sent;
  - reads the table at no start-up step: nothing crashes or refuses.

  This image, meeting a database without the grant (before the import, or after rollback R-2's
  delete), simply has a charge nurse without the key: 403 on the writes; the administrator keeps it
  by rule.
- **Sessions.** A charge nurse signed in before the import holds a token without the key until it is
  refreshed (an access token's life), as B1a's O46.
- **Dashboard and tests.** Its mirror: `screens/admin/catalogue.js` (+ `catalogue.test.js` parity),
  `i18n/strings/perms.js` in four languages, `screens/admin/admin.testutil.js`.

### 4.7 Audit

Rows are written after the commit, under the tenant's slug, with `subject` = the monitor's address.
`patient_id` is the board id of the admitted patient on the bed whose link the row's change starts or
ends, when that bed was occupied and the change was confirmed with `confirm_occupied` (O5): for the
moving device's row, the target bed's patient, else the patient of the bed it leaves; for a displaced
device's row, the target bed's patient. Otherwise "". The payload's `occupied` lists every occupied
bed the change confirmed, `[{bed_id, patient_id}]`. No row ever carries a name (approved §2). Each
device's change is its own row (B1a A-4, "two changes, two rows").

- **`device_bed.bind`:**
  - `source`, `group`, `device_bed_label`;
  - `old` (null, or `{row_id, bed_id, unit_id, bed_label}` of the closed row);
  - `new` (`{row_id, bed_id, unit_id, bed_label}`);
  - `replaced_source` (or null);
  - `occupied_confirmed` (bool) and `occupied` (above);
  - `actor` (the username).
- **`device_bed.unbind`:**
  - the same keys, with `new` being the unbound row;
  - `reason`: `unbound` (the route) or `replaced` (the displaced monitor of a bind, with
    `by_source`).
- **`device_bed.relabel`** (D18 a): `source`, `bed_id`, `unit_id`, `old` and `new` (`{row_id,
  bed_label}`), `actor`; `patient_id` "" (the link does not change). Written after the rename's
  commit, beside its `structure.rename` row.
- **`device_bed.import`:**
  - `file_sha256`, `file_version`, `site`;
  - `rows`, `with_bed`, `without_bed`;
  - `version`, `sha256` (D19);
  - `granted`: `["charge_nurse"]` when the grant step inserted the key, `[]` when the group already
    held it or does not exist;
  - `actor: "import"`.

`rehydrate` ignores these kinds: it replays `ingest`, `chart`, `profile`, `ack`, `first_seen` and the
discharge rows only (`api/rehydrate.py:41-62`), so a `patient_id` on a `device_bed.*` row changes no
replay.

### 4.8 What a change does downstream (nothing new in Lane A's code)

- **The strip.** `board_view` reads the row valid now per device (`infinity_shadow.py:507-560`, the
  row at `:541`, at `cad9bea`). After
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
hospital=_shadow.hospital, ssl_required=…)` as `_samples` does (`prodserver.py:472-483`).

### 4.10 Yapı hooks (D18; `tenant/router.py` `patch_bed`, `:507-534`)

Both run inside `patch_bed`'s transaction, after its unit and bed locks (`_lock_unit`, `_lock_bed`)
and before its commit, through `homunculus/devicebeds/writes.py`. They read the tenant's current
bound row of the bed (`valid_to IS NULL AND bed_id = :bed`), `FOR UPDATE`.

- **Close (O7).** `is_active` true → false with a current bound row: 409 `bed_has_monitor`, nothing
  written. Checked beside the existing `bed_in_use` rule.
- **Rename (O3).** A label change (`label != bed.label`) with a current bound row whose `bed_label`
  differs from the new label: read `t` (§4.4), close that row (`valid_to = t`), insert the same
  device and bed with `bed_label` = the new label, `method: editor`, `verified_at` = `t`,
  `verified_by` = the actor's id, `device_bed_label`, `group_address`, `port`, `unit_id` carried,
  `approved_by` = the actor, `approved_at` = `t`. Committed with the rename (one transaction); after
  the commit, `device_bed.relabel` is audited and the accessor invalidated
  (`app.state.shadow_table_reset`, when the app has one). A label-only v2 row (BED01: a label, no
  `bed_id`) is no Yapı bed's and is never relabelled.

Lock order is unit → bed → mapping rows; the bind route takes beds → mapping rows and no unit lock, so
the two never wait on each other in a cycle. The hooks run whatever the lane's stage: Yapı is not the
strip, and a rename must not leave a stale label behind for when the stage comes on.

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
  verified_at      varchar(40) NULL                  -- (Row.verified_at) v2's date as written, or an editor row's UTC ISO time (D21)
  verified_by      uuid NULL                         -- the acting user's id on an editor row; NULL on seeded rows (D21)
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
- **No data** (O11, D20). 0014 is purely additive: it creates the table, its constraints, its three
  indexes, the function and the two triggers, and changes no existing table, column, index or row.
  `verified_at` is text because `Row.verified_at` is text and the import copies v2's dates byte for
  byte (exact parity), while an editor row's is a timestamp (D21). `verified_by` has no foreign key:
  history outlives an account, as the audit's actor does.

One statement per `op.execute` (asyncpg; see 0004, 0010, 0013).

**Downgrade** removes, in this order, exactly what the upgrade made:
1. the triggers and the function;
2. the indexes;
3. the table, with every mapping and its history.

It touches no other table: the `devices.map_beds` rows of `group_permissions` (the import's grant)
stay, harmless to the old code (§4.6); rollback R-2 deletes them explicitly (§7.3). Back up first.
After a downgrade the old code reads the file again; §7.3.

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
- `rows_digest(rows) -> str` (D19, Lane A's rule): the hex SHA-256 of
  `json.dumps(sorted([r.source, r.bed_id, r.bed_label] for r in rows), separators=(",", ":"),
  ensure_ascii=False).encode("utf-8")` over the CURRENT rows, `bed_id` as its string or null and
  `bed_label` the strip's label (null for an unbound row). Sources are unique among current rows, so
  the sort is by source;
- `check_current(rows)`: one current row per source; one current bound row per `bed_id`; a bound row
  has a `bed_label`.

`check_current` deliberately does NOT apply the file's label rule `_same_bed`. That rule would refuse
the whole table, and put every monitor off its bed, if a Yapı label happened to equal a label-only
row's (BED01). Beds are told apart by `bed_id`, as `board_view` does (`infinity_shadow.py:533-536`,
at `cad9bea`).

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
  the tenant's `max(id)` (D19) and name. History stays in the table and is not loaded. Editor rows
  start at the database's time `t` (§4.4), so a `board_view` resolved at an injected clock earlier
  than the database's (a test's fake clock) does not see them yet; on the VM the API and the
  database share the host's clock.
- **The answer** is a `TableState`:

  | Field | Value |
  |---|---|
  | `status` | `ok`; `missing` (the tenant has no rows: "eşleme tablosunda bu hastane için satır yok"); or `invalid` (the database unreadable: "eşleme tablosu okunamadı", or a `check_current` violation, naming it). |
  | `table` | `DeviceBedTable(version, site, approved_by, approved_at, rows)`. |
  | `version` | `max(id)` of the tenant's `device_beds` rows, history included (D19, O10). It only grows: every change inserts a row and nothing is deleted. It is 13 after the import into a fresh table (ids 1–13), and rises by one per inserted row (a bind or unbind of one device: +1; a replace: +2). |
  | `sha256` | `rows_digest` of the current rows (D19). Two tables with the same devices on the same beds under the same strip labels hash alike, whatever their history. |
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
| `verified_at` | `verified_at` | file, as written | `t`, UTC ISO-8601 (`2026-10-30T09:12:03.120000+00:00`) | `t`, the same |
| — | `verified_by` | NULL | the actor's user id | the actor's user id |
| `note` | `note` | file | NULL | NULL |
| `valid_from`, `valid_to` | same | file | `t`, NULL | `t`, NULL |
| — | `device_bed_label` | file's `bed_label` | carried from the device's last row | carried |
| — | `approved_by`, `approved_at` | file's approver, the file date at 00:00Z | actor, `t` | actor, `t` |

A relabel row (D18 a) is an editor bind row of the same device and bed with the new label.

`method: editor` reaches the strip's card (`board_view` copies `method` and `verified_at`,
`infinity_shadow.py:552-553` at `cad9bea`). The dashboard gains `monitor.method.editor` so
`DevicesScreen.jsx:34` prints no raw key, and prints an editor row's `verified_at` in local time (§3.6,
O9).

### 5.4 The seed import — `homunculus-engine/scripts/import_device_beds.py`

This is a script, not data inside the migration: the migration runs on every database, including the
lab and the tests. Its arguments are `--file` (default `/etc/homunculus/infinity-shadow/device-beds.json`),
`--tenant` (default `INFINITY_SHADOW_HOSPITAL`) and `--dry-run`.

1. **Read and check the sha.** Read the file capped (`read_capped`) and refuse unless its sha256
   equals `APPROVED_V2_SHA256 = "84ac1760d59f31b9ab016ca30f08cb1e7387addb02355ea02e3600e4e7ed584d"`.
   A test pins that constant to the committed file.
2. **Parse** with Lane A's own reader (`TableFile`/`parse_table`); the status must be `ok`.
3. **Check the beds.** In one transaction (the tenant's row in `tenants` locked, so two imports run
   one after the other), look at the tenant's `device_beds` rows:
   - none: go on;
   - some, and the tenant's current rows equal the file's rows `Row` for `Row`, in file order: the
     import is already done. Nothing is written, no audit, and the line of step 6 is printed with
     `"already": true` (exit 0). Re-running the import is therefore safe;
   - some, and they differ (an edit was made since, or another file was imported): refuse, exit 3.

   Every `bed_id` must be a bed of this tenant, and every `unit_id` must be that bed's room's unit.
4. **Insert** the rows in file order, per §5.3. **Grant** `devices.map_beds` to the tenant's
   `charge_nurse` group (§4.6, O11). Commit both at once.
5. **Audit.** Write `device_bed.import` (with `granted`, `version`, `sha256`) through the Postgres
   audit log. Concurrent appends are safe: `audit_postgres.py:54-60`.
6. **Print** one line, `ESLEME_ICE_AKTARIM {"tenant","file_sha256","rows","with_bed","without_bed",
   "granted","version","sha256","already"}`, where `version` and `sha256` are the values the accessor
   reports (D19), computed by the same functions from the rows read back after the commit.

Exit codes:
- 0: imported, or already imported (`"already": true`, nothing written);
- 2: refused (sha, parse, bed or unit check), nothing written;
- 3: the tenant's table holds other rows than the file's, nothing written.

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
  with exit 2 and write nothing. A second run over untouched rows gives exit 0 with `"already":
  true` and writes nothing (no row, no audit, no grant); a run over a table edited since gives exit 3.
  `--dry-run` writes nothing. The constant equals the committed file's sha256. The grant: the
  tenant's `charge_nurse` holds `devices.map_beds` after the import, no other group gains it, a
  second tenant is untouched, and an administrator's later removal is not undone by a re-run. The
  printed `version`/`sha256` equal what `PostgresDeviceBeds.current()` then reports.
- **Accessor.**
  - `missing` and `invalid` place nothing;
  - the 10-s cache, and `invalidate()`;
  - only current rows are loaded;
  - `version` is `max(id)` and grows with each inserted row; `sha256` is `rows_digest` (D19): an
    unbind followed by a rebind to the same bed under the same label gives back the first sha, and
    a relabel changes it;
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
  - audit rows: kinds, `old`/`new`, actor; `patient_id` is the confirmed occupied bed's patient
    (O5) and "" otherwise. The admitted patient's name appears nowhere in any new audit row or
    response body. A failing audit store still answers 200 and logs (A-26);
  - `changed: false` for a resend after a lost answer (judged before `expected`);
  - editor rows: `method` `editor`, `verified_at` the change's database time, `verified_by` the
    actor (D21);
  - downstream: after a bind, `GET /infinity-shadow/board` shows the monitor on its new bed at the
    next read. At stage `rules`, the next readings body links the bed's patient.
- **Route tables:**
  - `test_route_permissions.py`: three new routes (59 → 62), the new module in `GUARDED_MODULES`, and
    `GET /tenant/structure` with the new key;
  - `test_route_inventory.py` passes unchanged (JWT routes);
  - `test_nginx_routes.py`: the three paths;
  - `test_permissions.py` and `catalogue.test.js`: the catalogue.
- **Yapı hooks** (D18): a rename of a bound bed relabels its current row in the same transaction
  (one closed, one open, `device_bed.relabel`, the strip's label follows at the next read); a rename
  of an unbound bed, and a rename to the label the row already has, write no mapping row; a refused
  rename (`bed_label_taken`) writes none; closing a bound bed is `bed_has_monitor` and writes
  nothing; closing it after an unbind passes.
- **Migration** (`tests/test_migration_0014_device_beds.py`):
  - 0013 → 0014 → 0013 → 0014 on the real chain;
  - purely additive (O11): every table, column, index and row that existed at 0013 is the same at
    0014 and again after the downgrade (a snapshot of `information_schema` and of each table's row
    count), and 0014 inserts no `group_permissions` row;
  - the two partial indexes refuse a second current row per device and per bed, and allow closed
    history;
  - the trigger refuses DELETE and any UPDATE but a close;
  - the downgrade's order: after upgrade then downgrade, neither the table, nor a `device_beds_%`
    trigger, nor the function remains (R-2);
  - model/migration type parity.
- **Dashboard:**
  - the list: columns; absent with and without last seen; «başka birimde»; editable gating;
  - the three dialogs: pick, confirm naming both monitors, the occupied step with focus on «Vazgeç»;
  - `bed_occupied` from the server opening the occupied step, which names the patient only as
    «Ahmet Y.» from the session's board card, and says "an admitted patient" without one; no number
    is rendered (O5);
  - `mapping_changed` reloading the list;
  - the route's new `perms`; `STRUCTURE_PERMS`;
  - `apiErrors.test.js` (the five new codes mapped);
  - `strings.test.js` (parity; az ≠ tr); `rawKeys.test.jsx`; no UUID rendered;
  - the strip's method line: `monitor.method.editor` and an editor row's time in local time;
  - the two Yapı fixes and the `bed_has_monitor` toast (`StructureTab.test.jsx`);
  - `vite build`.
- **Local walk** on a separate stack, with a synthetic structure and synthetic devices (no real
  data). In az, headless Chrome, at 390 and 1440 px:
  - import a synthetic table;
  - bind, replace, move and unbind, and see the strip follow;
  - the occupied-bed step;
  - a charge nurse's scope;
  - the Yapı fixes, a rename followed by the strip, and the `bed_has_monitor` refusal;
  - the R-1 rehearsal (O11, §7.3): the pre-slice image (main `cad9bea`) started with R-1's override
    against the database at 0014 serves `/health` and the board (table version 2, the file's sha),
    then the stack rolls forward again (new image, `upgrade head` a no-op, import `already`).

## 7. Deploy

### 7.1 Rollout and Lane A review

Branch `feat/g2b-monitor-esleme`, rebased onto main `cad9bea` (NBP-2); migration **0014**. NBP-2
deploys first; this slice's deploy waits for it, for the user's «main'e al» and for «onay». Lane A
reviews every hunk in:
- `alembic/versions/0014_device_beds.py` (O2, O11);
- `api/infinity_device_beds.py` (the protocol, `TableFile.invalidate`, `rows_digest`, `check_current`);
- `api/device_beds_postgres.py` (what the strip and Aşama B now read);
- `api/app.py` (wiring, hooks, `_occupants` helper);
- `api/prodserver.py`;
- `api/infinity_shadow.py` (no change expected; any hunk there is Lane A's);
- `screens/devices/DevicesScreen.jsx` (Aşama A's screen) and `i18n/strings/monitor.js` (one key);
- the new read-only summary script in `deploy/infinity/` (below), and `deploy/infinity/README.md`.

Merge and deploy happen on the user's word, one deploy at a time across both lanes. The code ships as
a git bundle (the VM has no git credential).

### 7.2 Blocks the user pastes

Every `docker compose run|exec`, `psql` or `ssh` inside a pasted heredoc takes `</dev/null`. Each
block stops at its first error, and "durdum" means nothing changed.

The file of blocks is `/c/tmp/infinity-a-releases/G2B-ESLEME-bloklari.txt`, on the model of
`G2B1a-bloklari.txt`. **Its header says the blocks start only after Lane A reports NBP-2's deploy
done and the user says «onay»** (one VM deploy at a time; NBP-2 was at its D-1 on 2026-10-30). Five
groups:

- **A — pre-checks and rollback tags** (VM):
  - the running code is main `cad9bea` (NBP-2 deployed), `alembic current` = 0013, the stage, the
    disk;
  - `pg_dump` of the database;
  - `docker tag` of the running api and web images as `homunculus-rollback/{api,web}:pre-esleme`
    (refusing to overwrite an existing tag);
  - `sha256sum` of the deployed `deploy/local/infinity-shadow/device-beds.json` must begin
    `84ac1760d59f` (stop otherwise);
  - the "before" summary of `GET /infinity-shadow/board` (tenant token, as
    `deploy/infinity/shadow_check.py` reads it), printed as `ESLEME_OZET_ONCE {...}`: the sorted
    `(source, bed_id, bed_label)` of every bed card, the sorted unassigned sources with reasons, the
    number of `link: one` cards, and `feed.devices.total`;
  - the override file of §7.3 (R-1), written to `~/esleme/` and checked, before anything changes.
- **B — bundle, migrate, import, restart** (VM), back to back in one block:
  - fetch the bundle, check it out, and build the api and web images;
  - apply 0014 with the NEW image in a one-off container
    (`docker compose run --rm --no-deps -T api alembic upgrade head </dev/null`) while the old API keeps
    serving (D20: nothing it reads changes);
  - print `alembic current` = 0014;
  - `docker compose run --rm --no-deps -T api python scripts/import_device_beds.py --tenant <slug> </dev/null`
    must print `ESLEME_ICE_AKTARIM` with 13 rows, 12 with a bed, 1 without, `granted:
    ["charge_nurse"]` (or `[]` if the group already held the key), and its `version` and `sha256`
    (stop otherwise); the block saves the line to `~/esleme/import.txt`;
  - then `docker compose up -d api web` from the new images, and wait for health;
  - the import comes before the new API starts, so the strip never shows a missing table. If the old
    API restarts between the migration and the new start, it stops at its own `alembic upgrade head`
    (O11); the block's note says to go on with B, or to start it with R-1's override.
- **C — the strip before and after** (agent, read-only, from the workstation): `shadow_check.py`
  before A and after B, with `--table-version` and `--table-sha` from `import.txt` (D19):
  - **pinned by commit, never by branch** (Lane A, 2026-10-30). Every run in every block is
    `git -C <local worktree> show ade8da8:deploy/infinity/shadow_check.py | ssh -i ~/.ssh/homunculus_vm sysadmin@172.100.101.72 'python3 - --window 60 --table-version <v> --table-sha <sha12> …'`.
    `ade8da8` is main (2026-10-30), which holds the fix `7fe61a9`; the script is identical at both,
    so `7fe61a9` is an equivalent pin. Here ssh's stdin IS the script, by the pipe: it reads no line
    of a pasted heredoc, so it takes no `</dev/null` (every other stdin consumer in a block does);
  - why the pin: at `cad9bea`, `shadow_check.py` judges the stage first and reports anything but
    `shadow` as RED (`deploy/infinity/shadow_check.py:94-98`) — the VM runs `rules`; the fix
    (`7fe61a9`, on main since `ade8da8`) judges `rules` like `shadow`, as NBP-2's blocks ran it;
  - its `PANO_OZET` leaves out each card's `shadow` picture, so a hash taken before 2026-10-30 (with
    the older script) is not comparable: the "before" reading is taken in C, before A, with the same
    pinned script;
  - what it compares for the table (`:101-106`): `status` `ok`, `version` equal to `--table-version`,
    `sha256` starting with `--table-sha`; then the unassigned sources against `--unassigned`
    (`:113-115`), the feed, the lag and the forwarder's posts;
  - `ESLEME_OZET_SONRA` must equal `ESLEME_OZET_ONCE` for the bed cards, the unassigned devices and
    the `link: one` count; the block prints both and says so if an admission or discharge happened
    between. The board's `table.version` is 13 and `table.sha256` is the import's;
  - the strip on screen looks as before.
- **D — the live try on screen** (the administrator; O4). One EMPTY bed's monitor is unbound and
  then bound again to the same bed, so the mapping ends as it began:
  - **Which bed.** Any v2 bed whose row is bound to a Yapı bed (never BED01, `10.10.203.25`, the
    label-only row), with no open admission and no admitted patient on the board at the time; the
    block checks both read-only (`admissions` in an open state; the board's card for that bed has
    `link` `none`) and prefers a bed whose Yapı label equals its v2 label byte for byte;
  - **On screen.** «Bağlantıyı çöz» → confirm; the list says «bağlı değil», the strip
    «atanmamış cihaz». Then «Yatağa bağla» → the same bed → confirm; the strip shows it on its bed;
  - **Expected rows** (printed read-only): two audit rows, `device_bed.unbind` (`reason: unbound`,
    `old` the v2 row, `new` the unbound row) then `device_bed.bind` (`old` the unbound row, `new`
    the bound row), each with `patient_id` "" and the administrator as actor; that source's three
    table rows (v2's closed, the unbound one closed, the new bound one open, `method: editor`);
  - **version** = the import's + 2 (two rows inserted, D19);
  - **sha256** back to the import's value when the bed's Yapı label equals its v2 label. When it does
    not (the v2 notes record the Yapı beds as «bed05 … bed25» against v2's «BED05 … BED25»), the
    rebind names the bed by its Yapı label (D14), the strip reads «bed05» where it read «BED05», and
    the sha is the one the block predicts from the import's rows with that one label replaced. The
    block prints which case holds BEFORE the try, and stops for the user's word if it is the second
    (O4a).

### 7.3 Rollback

**Why the old image cannot restart by itself at 0014 (O11).** Its start command is `alembic upgrade
head && python scripts/seed_admin.py && exec uvicorn …` (`homunculus-engine/Dockerfile.api:51`).
Against a database whose `alembic_version` is 0014, the old image's Alembic has no script for that
revision and stops with "Can't locate revision identified by '0014'"; the `&&` chain ends there,
uvicorn never starts, and `restart: unless-stopped` (`deploy/local/docker-compose.yml:39`) starts it
again in a loop. Nothing else checks the revision (no other Alembic reference in `src/`). This holds
whatever 0014 contains; what D20 guarantees is that the old CODE can serve against 0014 — only its
start command refuses.

**R-1 — the fast path: the old images, the database left at 0014** (Lane A accepted it, 2026-10-30;
also the way to start the old API if it stops between B's migration and B's new start).

- **The override is the old image's OWN start command with only the migration step removed.** At
  `cad9bea` that command is the image's `CMD` (`homunculus-engine/Dockerfile.api:51`):
  `["sh", "-c", "alembic upgrade head && python scripts/seed_admin.py && exec uvicorn homunculus.api.prodserver:app --host 0.0.0.0 --port 8000"]`;
  the compose file sets no `command:`, `entrypoint:` or `user:` for `api`
  (`deploy/local/docker-compose.yml:34-130`), and the image has no `ENTRYPOINT`. The blocks write, in
  A, outside the repository, `~/esleme/eski-imaj-0014.yml`, with exactly:

  ```yaml
  services:
    api:
      command: ["sh", "-c", "python scripts/seed_admin.py && exec uvicorn homunculus.api.prodserver:app --host 0.0.0.0 --port 8000"]
  ```

  Nothing else: the entrypoint (none), the user (`USER homunculus`, `Dockerfile.api:37`), the one
  uvicorn worker (no `--workers`) and the health check (`HEALTHCHECK …/health`, `:42`) stay the
  image's own. Block A prints the running image's `Config.Cmd` and stops unless it is that CMD.
- **What R-1 does.** It retags `:pre-esleme` onto the images compose runs and starts `api` and `web`
  with `-f docker-compose.yml -f ~/esleme/eski-imaj-0014.yml`. While the database is at 0014 under
  the old image, every `up` of `api` takes the override.
- **What R-1 leaves behind (the block says it in one place).** The old code reads the mapping from
  the v2 file, so the strip shows the file's mapping and does not see any bind made since the deploy;
  those binds stay in `device_beds`, with their history and audit rows, and redeploying the new image
  brings them back; the `devices.map_beds` grant stays in `group_permissions`, dropped from every
  token, and the old Rollar shows the charge nurse's column read-only, naming the key (§4.6). After
  the restart the block prints the board's `table.version` and `table.sha256` and expects `2` and
  `84ac1760d59f…` — the file's.
- **Forward again after R-1 is safe.** 0014 is already applied, so the new image's `alembic upgrade
  head` is a no-op; the import answers `"already": true` over untouched rows, or exit 3 if binds were
  made — which are then kept as they are (§5.4).

**R-2 — full: back to 0013.**
- `docker compose run --rm --no-deps -T api alembic downgrade 0013 </dev/null` with the NEW image
  (the old one does not know 0014). The downgrade drops the triggers (and their function) BEFORE the
  table (§5.1), so no trigger stands on a dropped table;
- the block then checks, read-only through `psql … </dev/null`: `SELECT to_regclass('public.device_beds')`
  is null, no trigger `device_beds_%` and no function `device_beds_history_kept` remain, and
  `alembic current` reads `0013`; it stops otherwise;
- `DELETE FROM group_permissions WHERE permission = 'devices.map_beds'` through `psql … </dev/null`,
  printing the count (the import's grant; not part of 0014's downgrade, §5.1);
- the `:pre-esleme` images back and `up -d api web` with their own command (no override);
- the old code reads the file again, unchanged on disk; the board's table reads version `2`, sha
  `84ac1760d59f…`;
- mapping changes made since the deploy are lost from the table; the dump and the audit rows keep
  them.

**The rehearsal.** The local walk (§6) rehearses R-1 on its stack at 0014: the pre-slice image (main
`cad9bea`) started with the override against the migrated database serves `/health` and the board
(table version 2), then the stack rolls forward again (the new image, no migration, the import
`already`).

A future slice's image could start against a newer, additive database by itself (a start step that
tolerates a revision it does not know); that is Lane A's to decide and not in this slice.

### 7.4 Docs

- `deploy/infinity/README.md`: the table now lives in the database, the file is history, the import
  (and its grant), `version`/`sha256` (D19), the rollback (R-1, R-2).
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

## 9. Resolved items (2026-10-30)

The O-numbers are kept. Each entry states the answer and where the body carries it.

- **O1 Where exactly — RESOLVED (user, 2026-10-27; final).** The rail screen «Monitörler» (`/devices`,
  `DevicesScreen.jsx`): every device and no patient. Not the Yataklar screen's «Monitörler —
  doğrulanmamış» section (`BedsScreen.jsx:62`). D1, §3.1.
- **O2 Column names — RESOLVED (Lane A: keep the proposal).** One `source` column (it IS the IP);
  `group_address`, mapped back to `Row.group`; plus `bed_label`, `method`, `verified_at` and `note` for
  exact parity, and `verified_by` (O9). Lane A reviews the migration hunk (§7.1). §5.1.
- **O3 The strip's label after a Yapı rename — RESOLVED (controller).** A rename that changes a bound
  bed's label closes its current row (`valid_to` = t) and opens a new one with the new label: the
  same device and bed, `method: editor`, audited as its own kind `device_bed.relabel`, in the rename's
  own transaction — so the strip follows renames. The seed's «BED05»-style labels stay until a rename
  or a rebind; parity holds at import. D14, D18 a, §4.7, §4.10.
- **O4 The live try — RESOLVED (controller).** D unbinds one EMPTY bed's monitor and binds it again to
  the same bed; never BED01 (`10.10.203.25`, the label-only row). The bed: any v2 bed with no open
  admission and no admitted patient on the board at the time, checked in the block. Expected: two
  audit rows (`device_bed.unbind`, `device_bed.bind`), `version` up by 2, `sha256` back to the
  import's. §7.2 D.
  - **O4a — for the user, before the deploy.** The sha returns to the import's only if the bed's Yapı
    label equals its v2 label byte for byte. The v2 file's notes record the Yapı beds as «bed05 …
    bed25» and its labels are «BED05 … BED25»; if the VM's Yapı labels are indeed lower-case, the
    rebind leaves that bed reading «bed05» on the strip (D14) and a new sha. The block prints which
    case holds before the try and stops for the user's word in the second: accept the one changed
    label, rename that Yapı bed to «BED05» first (a no-op for the mapping, D18 a), or skip D.
- **O5 Naming the patient — RESOLVED (Lane A agreed).** The second confirmation shows only the short
  name, «Ahmet Y.» (the first word of the name and the initial of its last), from the session's own
  board card; no number, no birth date. The audit row carries the patient id. The server sends no
  name to the device screen. The strip itself names no patient at `cad9bea` (`MonitorStrip.jsx`; the
  bed card prints the whole `display_name`, `BoardState.jsx:172`), so the short-name rule is new code
  of this slice, in the dashboard. D4, D11, §3.3, §4.7.
- **O6 Last seen after an API restart — unchanged.** In memory only; «son görülme bilinmiyor» until
  the worker reports the device again. Not in this slice.
- **O7 Closing a Yapı bed with a monitor bound — RESOLVED (controller).** Refused, stable code
  `bed_has_monitor`; the screen says to unbind the monitor first on «Monitörler». D18 b, §3.7, §4.5,
  §4.10.
- **O8 A history view on screen — unchanged.** Not in this slice.
- **O9 `method` and `verified_at` of an editor row — RESOLVED (Lane A wording).** `method: "editor"`,
  `verified_at` = the database time of the change in UTC ISO-8601 (`t`: `clock_timestamp()` read once
  after the locks, in the committing transaction), `verified_by` = the user id. The importer copies
  v2's `method` and `verified_at` per row unchanged. D21, §4.4, §5.1, §5.3.
- **O10 `version` and `sha256` — RESOLVED (Lane A rule).** `version` = `max(id)` of the tenant's rows;
  `sha256` = SHA-256 of `json.dumps(sorted [source, bed_id, bed_label] of the current rows,
  separators=(",",":"), ensure_ascii=False)`, `bed_id` a string or null. `shadow_check.py`'s
  `--table-version`/`--table-sha` stay; the import prints both; the blocks quote them. At `cad9bea`,
  `shadow_check.py` compares: the stage, which must be `shadow` (`:94-98`; anything else, `rules`
  included, is one RED row and nothing more — the fix `7fe61a9`, on main since `ade8da8`, judges
  `rules` like `shadow`, and the blocks run it pinned at `ade8da8`); the table's `status` `ok`, `version` equal to
  `--table-version` and `sha256` starting with `--table-sha` (`:101-106`); the unassigned sources
  against `--unassigned` (`:113-115`); the feed, the lag, the forwarder's posts. D19, §5.3, §7.2 C.
- **O11 The old image and 0014 — RESOLVED (Lane A).** 0014 is purely additive (no change to an
  existing table or row; the grant moved out). The old image cannot restart by itself at 0014 because
  its start command runs `alembic upgrade head` first (`Dockerfile.api:51`), which stops on a revision
  its scripts do not hold; its code can serve against 0014. The blocks start it with that step left out
  (R-1's override). Rollback = `alembic downgrade 0013` plus the `:pre-esleme` tags (R-2). The
  `devices.map_beds` grant to `charge_nurse` is the import's one-time step, not 0014 and not a boot
  step; the administrator holds the key by rule; an old image drops an unknown key from every token
  and makes that group's Rollar column read-only (§4.6). D2, D20, §4.6, §5.1, §5.4, §7.3.
- **O12 Native-speaker review — unchanged** of the new az/ru/en texts, as for B1a.
- **O13 One lane hospital — unchanged.** The table is per-tenant, but the lane reads one hospital
  (`INFINITY_SHADOW_HOSPITAL`); another tenant gets `monitor_lane_off` (D15).

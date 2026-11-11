# G4-04 — «İş yükü»: who looks after which bed this shift, and how much work each unit carries

**Date:** 2026-11-12 · **Lane:** B (session homunculus-ai-bb) · **Branch:** `feat/g4-is-yuku`, cut from main `c9a3c9fd`
· **Guide section:** §3.26 · **Migration:** one, `0022` (see D8 for its parent)

**Origin.** The design prototype's «İş yükü» screen (`origin/tasarim/prototip`, `tasarim-taslaklari/app/birim.js`
194–325, perms `staff_view` + `occupancy`) shows, per unit and shift, patients, nurses, patients per nurse, high-risk,
late and remaining tasks, a per-hour distribution, one card per nurse (alphabetical, «sıralama değildir»), an
unassigned group, a «Yeniden dağıtım önerisi» and a «Hemşire ata» modal. Its header rules: «kişi sıralaması yok (iş
yükü birim ve vardiya düzeyinde), eşik/oran uydurulmaz»; «Puan/ölçek YOK: yalnız sayım. Geciken iş birime yazılır,
hemşire satırında gösterilmez». The live rule (`docs/tasarim-prototipi-canli-sistem-notu.md`): «ekran sayabilir ama
uyduramaz». B1c §7, G3-02 D15/O4 and roadmap decision 12 deferred a screen and a reader for the nurse–bed assignment.

## 1. What the system really has (exploration, 2026-11-11)

| Need | Source today | Gap |
|---|---|---|
| Which nurse has which bed | `nurse_bed_assignments` (0002): unit, bed, nurse, charge nurse, `shift_start`/`shift_end`, `is_active`, `created_at`; written only by `POST /shift-schedule` (`shifts.manage`) | **No screen writes it, no code reads it**, no GET route, no audit row; rows only accumulate (no uniqueness, `is_active` never cleared); beds checked against the tenant, not the unit; almost certainly empty on the VM |
| The shift | per-tenant `task_settings` `shift_start_a` (08) / `shift_start_b` (20) and the tenant time zone; G3-03's `fluid_day` already cuts the two 12-hour windows (`api/fluids.py`) | — |
| Patients now | `/tenant/structure` bed states (OCCUPIED, PENDING_DISCHARGE, PENDING_TRANSFER_OUT = occupied, as `occupancy.js` counts) | — |
| Tasks now | `GET /tasks`: hand tasks (`late` flag) and the vital task, per card with `identity.unit_id`/`bed_key` (G4-02) | tasks have a role, not an assignee |
| Alarms waiting now | the live board, `needsAnswer`, per card unit (G4-02 already counts them by unit) | only while the board is LIVE |
| Care team | B1c `care_team_members` | physicians only — no nurses |

**No source:** a nursing acuity score or weighting (NEWS2 bands do not map to nursing work), a target nurse ratio
(the unit's `max_beds_per_nurse` is a code default of 2 that no hospital has set), «Yeniden dağıtım önerisi», form /
medication / care-plan task kinds, a «yüksek risk» flag of its own.

## 2. Owner's decisions (2026-11-11)

- **D1 — «Atama ekranı + iş yükü».** The charge nurse assigns nurses to beds at the start of a shift (written to the
  audit trail). The workload page shows, per unit and for the current shift, patients, nurses, patients per nurse,
  unassigned patients, late and remaining tasks, alarms waiting an answer; nurse cards by name but alphabetical (no
  ranking); late work is written to the unit, never to a person. No score, no scale: counts only.
- **D2 — «Sorumlu hemşire + yönetici».** A new key `workload.view`. The default `charge_nurse` group («Sorumlu
  Hemşire») gets it through a migration; `hospital_admin` holds it by rule; other groups can get it on the Roles screen.

## 3. Decisions taken in the spec

### D3 — the shift

A shift is one of the tenant's two 12-hour windows: A = [`shift_start_a`, `shift_start_b`), B = [`shift_start_b`,
next `shift_start_a`), in the tenant's time zone — the windows G3-03's `fluid_day` already computes (one shared helper;
the plan moves or reuses it, no second copy). «Bu nöbet» is the window containing now; «Sonraki nöbet» the one after.
An assignment belongs to exactly one window: its `shift_start`/`shift_end` are that window's bounds.

### D4 — engine: the assignment

The table stays; its rules are tightened.

- **`GET /shift-schedule?shift=current|next[&unit_id=…]`** — guard: `shifts.manage` **or** `workload.view`. Answer:
  `{ shift: {start, end, which: "A"|"B"}, units: [ { unit_id, unit_name, items: [ {bed_id, nurse_id, nurse_name} ] } ],
  generated_at }` for the units in the caller's reach (unit grants, as `unitscope.unit_clause`; an unrestricted caller
  gets every unit); only **active** rows of that window; units with no row are listed with `items: []` when in reach.
  Staff names only (`full_name`, else username); no patient anywhere.
- **`GET /shift-schedule/nurses?unit_id=…`** — guard `shifts.manage`. The people offered in the form: active members of
  the caller's tenant who belong to the default `nurse` or `charge_nurse` group (by slug), `{id, name}`, by name. (A
  hospital's own nurse group is not offered: a stated limitation, D7.)
- **`PUT /shift-schedule`** — guard `shifts.manage`. Body `{ unit_id, shift: "current"|"next", items: [ {bed_id,
  nurse_id} ], expected: [ {bed_id, nurse_id} ] | null }`. Replaces that unit's assignment for that window: earlier
  active rows of the window are set `is_active = false` (kept as history), the new rows inserted, all in one
  transaction under a per-unit lock. Checks: the unit is in the caller's unit reach (a bed grant is not enough; 403);
  every bed belongs to **that unit** (422 `field_invalid:items`) and is active; every nurse is an offered person (422);
  a bed appears once (422); `expected`, when given, must equal the active rows read under the lock, else **409** with
  the existing concurrent-change text (as `PUT /scope/{user_id}`). The answer is the new state plus the existing soft
  warnings (S-25: a nurse with more beds than the unit's `max_beds_per_nurse`), which the form shows as warnings, not
  refusals. **Audit** `shift.assign` after the commit: `{unit_id, shift_start, shift_end, before: [[bed_id, nurse_id]…],
  after: […], actor}` (ids only; names are read at display).
- **`POST /shift-schedule`** is retired (no caller; it let rows pile up and skipped the unit check). Its route-table
  entry goes; its tests move to the PUT.
- An empty `items` clears the window for that unit.

### D5 — engine: nothing else

No `/workload` aggregate: the page joins sources it already reads (G4-02's pattern). `GET /tasks`, the live board,
`/tenant/structure` and `/scope/me` are unchanged.

### D6 — the page `/is-yuku` «İş yükü»

Guard `workload.view`. Route `{ id: "isyuku", path: "/is-yuku", icon: <existing, chosen by the plan>, labelKey:
"isyuku.nav", shortKey: "isyuku.navShort", perms: ["workload.view"], work: true, nav: "main" }`, after `kalite`, before
`settings` (tail `["eczane","ozet","kalite","isyuku","settings"]`). No patient name or id anywhere: beds by their
structure label, nurses by name.

1. **Header:** «İş yükü», the shift («Bu nöbet · 08:00–20:00»), «HH:MM itibarıyla», «Yenile»; the line «Sayım, puan
   değil · kişiler sıralanmaz».
2. **Unit cards / table** (one row per unit in reach), for the current shift:
   - **Hasta** — occupied beds (`/tenant/structure`);
   - **Hemşire** — distinct nurses assigned in the unit this shift;
   - **Hemşire başına hasta** — assigned occupied beds ÷ nurses, written «{n} hasta / {m} hemşire» and the mean with
     one decimal; no target, no colour judgement;
   - **Atanmamış hasta** — occupied beds with no active assignment this shift;
   - **Geciken iş** — hand tasks the server marks `late` plus a late vital task, of the unit's patients (G4-02's rule);
   - **Kalan iş** — open hand tasks due within the shift, of the unit's patients;
   - **Yanıt bekleyen alarm** — the live board's `needsAnswer`, by unit (only while LIVE).
3. **Nurse cards** for the selected unit (or all units), **alphabetical by name**, the note «Alfabetik; sıralama
   değildir»: name, beds (labels), patients (occupied of them), open tasks of those patients, alarms waiting on them.
   **No late count on a nurse card** (late work belongs to the unit). Then an «Atanmamış» group with its beds.
4. **«Nöbet ataması»** (only with `shifts.manage`): the unit, «Bu nöbet» / «Sonraki nöbet», one row per active bed of
   the unit with a nurse picker (the offered people) and an empty choice; «Kaydet» sends the PUT with `expected`; a
   409 says «Bu arada başka biri değiştirdi — liste yenilendi; yeniden bakın.» and reloads; the S-25 warnings are shown
   under the form. A viewer with `workload.view` only sees the assignment, not the form.

**Every number is real or says why not** (Decision 18): loading, failed, refused, stale («pano güncel değil» for the
alarm column) and malformed sources show «—» with a reason, never 0; a unit with no assignment says «Bu nöbet için
atama yok» instead of «0 hemşire».

**Reading:** on open, on «Yenile» and every 60 s while visible (G4-02's `SUMMARY_POLL_MS`), reusing G4-02's reads
(`/tenant/structure`, `/tasks`, `/scope/me`, the board store) plus `GET /shift-schedule?shift=current`.

### D7 — not in this slice

The per-hour «Vardiya boyunca iş dağılımı»; «Yeniden dağıtım önerisi»; any score, scale or target ratio; showing
`max_beds_per_nurse` as a target on the page (only the form's existing soft warning uses it); the assigned nurse on the
bed cards or the patient screen; using the assignment for board scope, task routing or alarm paging; a hospital's own
nurse groups in the picker; shift history views; per-person «kim ne yaptı».

### D8 — the migration

`0022_workload_view`:
1. inserts `workload.view` for the default `charge_nurse` group of every tenant (0017/0020's pattern; `DEFAULT_GROUPS`
   gains it too); downgrade deletes it;
2. deactivates duplicate active rows in `nurse_bed_assignments` (same bed and same `shift_start`: keep the newest) and
   adds a partial unique index on `(bed_id, shift_start) WHERE is_active`; downgrade drops the index (the deactivated
   rows stay deactivated, as history).

Its `down_revision` is the head of main when it lands: `0020` today; **if G3-05's `0021` («Cihaz ölçüm kaydı») lands
first, it becomes `0021`** (one line; whoever merges second makes it; `alembic heads` stays one).

**It changes data, and its downgrade does not undo that.** Step 2 sets `is_active = false` on duplicate rows; the
downgrade drops the index and the key but **does not re-activate those rows** (it cannot tell them from rows a later
PUT deactivated). Deploy notes (Lane A, 2026-11-12): before the migration, a read-only count of the `(bed_id,
shift_start)` pairs with more than one active row and of the rows that would be deactivated (numbers only); the
rollback note says the deactivations stay; building the index briefly locks `nurse_bed_assignments`, so an assignment
save in those seconds waits. Retiring `POST /shift-schedule` cannot break an old web against a new api in the deploy
window: no dashboard version has ever called it.

## 4. Tests

**Engine:**
- the shift windows (A/B, midnight crossing, the tenant zone, «current»/«next»);
- `GET /shift-schedule`: either key; reach (unit grant, bed-only grant reaches nothing, unrestricted); only active rows
  of the window; quiet units listed; no patient data; tenant isolation;
- `GET /shift-schedule/nurses`: only the `nurse`/`charge_nurse` members of the tenant, active;
- `PUT /shift-schedule`: replace (old rows inactive, kept), a bed of another unit (422), an inactive bed, a person not
  offered, a duplicate bed, out-of-reach unit (403), `expected` mismatch (409, nothing written, nothing audited), empty
  items clears, S-25 warnings, one `shift.assign` audit row with before/after;
- the retired POST is gone; route tables (EXPECTED), nginx map and proxied paths, access-log redaction;
- the migration on a throwaway Postgres: the key for `charge_nurse`, duplicates deactivated, the index, downgrade;
- `workload.view` in the catalogue; the `shift.assign` label (the `/denetim` drift test reads it).

**Dashboard:**
- pure `isyuku.js`: the per-unit join (structure × assignments × tasks × board), unassigned beds, the nurse cards
  (alphabetical; no late count), Decision 18 reasons, «Bu nöbet için atama yok»;
- `IsYukuScreen`: unit selection, the form (picker, save, 409 reload, warnings), viewer without `shifts.manage`;
- routes (pinned tail), rawKeys, strings (four languages), the catalogue drift tests, `/denetim` `engineTypes` and the
  `shift.assign` label.

**Gates:** the engine's no-DB suite; the DB tests that touch shift schedules, tasks, the migration and tenant
isolation, on a throwaway Postgres on 127.0.0.1:5644x; the whole dashboard suite; `vite build`.

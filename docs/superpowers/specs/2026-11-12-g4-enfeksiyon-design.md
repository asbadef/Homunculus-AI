# G4-05 — «Enfeksiyon kontrol»: isolation, suspected infection, the antibiotic clock and the sepsis alarms, per unit

**Date:** 2026-11-12 · **Branch:** `feat/g4-enfeksiyon`, cut from main `88f6544c` (G3-05 included) · **Guide section:**
§3.28 · **Migration:** one, `0023_infection_view` (see D21 for its parent and the numbering rule)

**Origin.** The design prototype's «Enfeksiyon kontrol» screen (`origin/tasarim/prototip`,
`tasarim-taslaklari/app/birim.js` 57–90 strings, 318–390 screen; perm `quality` + `beds`, icon `shield`) shows cards
(«izolasyondaki hasta», «boş izolasyon yatağı», catheter / ventilator counts, «antibiyotik alan»), «İzolasyondaki
hastalar», «İzolasyon yatakları» as tiles, «Cihaz günleri», «Birim bazında cihaz-gün toplamı» with a utilisation
ratio, an infection-rate formula and «Antibiyotik günü». Its device days are **derived from a hash of the patient id**
when no nursing record exists (`devicesOf`), and every number is seeded. The live rule
(`docs/tasarim-prototipi-canli-sistem-notu.md`): «ekran sayabilir ama uyduramaz». None of the prototype's numbers is
carried over.

## 1. What the system really has (exploration, 2026-11-12, main `88f6544c`)

| Need | Source today | Gap |
|---|---|---|
| Suspected infection | `SignalCode.SUSPECTED_INFECTION` (`canonical.py:58`), `CHARTABLE` "bool" (`api/clinical.py:46`), charted by `POST /clinical/{id}` (`clinical.chart`); the card's three-valued `sepsis.suspected_infection` (`api/board.py:208` `_sepsis_context`); the patient screen's two buttons (`PatientScreen.jsx` `Chart` 201–251, `chart()` 384–421) | — |
| The antibiotic clock | `rules/antibiotic_clock.py` (`WINDOW` 1 h, cites `surviving-sepsis-campaign-2026`); the anchor in `pipeline.py` (`_RECOGNITION_KINDS = {"sepsis", "septic_shock"}`); the card's `meds` block (`api/board.py:153` `_meds`); Eczane's six states (`api/pharmacy.py` `antibiotic_of`) | — |
| Sepsis alarms | the card's `alerts` — firing ones and latched criticals (`resolved_at` set); kinds `sepsis` (HIGH), `septic_shock` (CRITICAL), `under_resuscitated_sepsis` (HIGH) from `rules/septic_shock.py`; `antibiotic_due` / `antibiotic_overdue`; the optional model's `sepsis_watch` (MODERATE) | the dashboard names an alarm by the engine's English `summary` (`summaryOf`); no kind label exists |
| Isolation rooms | `Room.is_isolation` (`tenant/models.py:144`), set only when a room is **created** (`RoomCreate`; `RoomPatch` has no such field); `/tenant/structure` carries it per room | an existing room cannot be marked (O1) |
| Bed states | `BedState`: AVAILABLE, OCCUPIED, PENDING_DISCHARGE, PENDING_TRANSFER_OUT, HOUSEKEEPING («temizlikte»), MAINTENANCE («bakımda»), BLOCKED («kullanım dışı», always with a reason), RESERVED («rezerve»); `BedStateReason.ISOLATION_CLEANING` is a reason **of BLOCKED** («İzolasyon temizliği»), not a cleaning state | `/tenant/structure` carries no `state_reason` (only `GET /tenant/occupancy`, which also carries patient short names) |
| Unit names | the database (`units.name`) | the board card carries `unit_id` only |
| The patient's isolation | — | **no record anywhere** (the transfer reason `ISOLATION`, `admission/models.py:163`, says why a patient moved, not that she is isolated) |
| Who charted a flag | the `chart` audit row's `charted_by` | the engine state holds no person; the audit read has no subject filter |

**No source:** device days (central line, urinary catheter, ventilator), device utilisation, infection (HAI) rates,
antibiotic days, cultures. The vault (`Homunculus/wiki/`) has sepsis and antibiotic-timing articles and **nothing on
isolation precautions or healthcare-associated infection**: this page makes no claim about isolation, records the
types a clinician enters, and proposes none.

## 2. Owner's decisions (2026-11-12)

- **D1 — «Mevcut veri + izolasyon».** The page shows what has a source today — suspected infection, the 1-hour
  antibiotic clock and its states, open sepsis / septic-shock / under-resuscitated-sepsis alarms, isolation rooms and
  their occupancy — plus one new record, the patient's isolation. Not built, and the page says so: device days, device
  utilisation, infection rates, antibiotic days, cultures.
- **D2 — «Yeni yetki: infection.view».** The 31st key. Default holders `attending`, `unit_physician`, `physician`,
  `charge_nurse`, `nurse`; `hospital_admin` by rule. `DEFAULT_GROUPS` for later tenants, migration `0023` for earlier.
- **D3 — «Klinik bayrak».** Isolation is four clinical flags charted like suspected infection: `ISOLATION_CONTACT`
  («Temas»), `ISOLATION_DROPLET` («Damlacık»), `ISOLATION_AIRBORNE` («Solunum»), `ISOLATION_PROTECTIVE` («Koruyucu»),
  through `POST /clinical/{patient_id}`; several at once; ending isolation = all four set to 0. No new table, no new
  write route. An «İzolasyon» box on the patient screen beside the suspected-infection control.
- **D4 — a server endpoint like Eczane:** `GET /infection` (`infection.view`), board-scoped as `/pharmacy`, rows and
  counts built by the server, Eczane's antibiotic states reused.
- **D5 — the page** `/enfeksiyon` after `isyuku`; the prototype's layout where data exists; names shown.
- **D6 — Decision 18:** never 0 or «yok» without a fresh answer; «—» with a reason.

## 3. Decisions taken in the spec

### D7 — the four codes at the chart door

- `canonical.py`: `ISOLATION_CONTACT = "isolation_contact"`, `ISOLATION_DROPLET = "isolation_droplet"`,
  `ISOLATION_AIRBORNE = "isolation_airborne"`, `ISOLATION_PROTECTIVE = "isolation_protective"`, in the «Clinical
  context» block after `ANTIBIOTIC_ADMINISTERED`.
- `api/clinical.py`: each in `CHARTABLE` as `"bool"` and in `_BOOLEAN` (0 / 1, JSON `true` / `false`; 0.5 is the
  door's existing 400 «yalnız 0 veya 1 olabilir»). A new `ISOLATION_CODES` tuple in that order (contact, droplet,
  airborne, protective) is the one list the board, the page, the replay and the dashboard's order follow.
- **Not withdrawable.** They stay out of `RETRACTABLE_CODES` (and so out of G3-05's `MANUAL_CODES` and the readings
  record): a flag is corrected by a new entry, as the suspected-infection mark is (X22).
- **The time rule covers them.** When a request sends `recorded_at` and charts an isolation code, `_check_bedside`'s
  bound applies (at most 24 h back, `AT_TOO_OLD`; at most `BEDSIDE_SKEW` ahead, `AT_FUTURE`). Without it a flag stamped
  tomorrow would stay the latest value and no save today could end the isolation. The box sends no time (the server's
  instant is the record's, as for the suspected-infection buttons).
- No rule reads them. Each entry is still one engine evaluation (as a charted weight is): a save is four `chart` rows
  and four evaluations. Charting one on an admitted patient the engine never measured creates that patient's engine
  state, exactly as a suspected-infection mark does today (the card stops being identity-only; `measuredAt` stays
  empty, so the screens still read it as unmeasured).
- The FHIR and HL7 gateways accept every `SignalCode` slug (`_SLUG_TO_CODE`, `_DEFAULT_MAP`), so a device feed could
  send a flag, as it could send `suspected_infection` today. Unchanged; such a value names no person (D8).

### D8 — the card's `isolation` block, and who charted it

`api/board.py` gains `_isolation(state, store, patient_id)`; `patient_board` carries it as `"isolation"`;
`identity_only_board` carries `"isolation": None` (its card keeps the board's keys; the box reads null as
«unrecorded», D16):

```json
"isolation": {"contact": true, "droplet": true, "airborne": false, "protective": null,
              "types": ["contact", "droplet"], "state": "isolated",
              "charted_at": "2026-11-12T08:10:00+00:00", "charted_by": "hemsire.sentetik"}
```

- Each flag is three-valued: `null` = never charted, else the latest value ≥ 1. `types` = the true ones, in
  `ISOLATION_CODES` order. `state`: `isolated` (a type is true), `not_isolated` (at least one flag charted, none true),
  `unrecorded` (none ever charted). The server decides the word; the page and the box only print it.
- `charted_at` = the newest timestamp among the four codes' latest observations (a save stamps all four alike).
- **`charted_by`** comes from the `AckStore` (one per hospital, already handed to `patient_board`): a new
  `isolation_charted: dict[str, dict]` (patient → `{"by", "at"}`), written by `chart_observations` for every isolation
  entry it writes (both doors that chart go through it), keeping the newest `at` (equal: the later write). Why there:
  it is the per-tenant store the card already reads its people from (`acknowledged_by`, `rrt_call.by`, `snooze.by`),
  `rehydrate` already restores it from the trail, and the discharge path already empties it (`forget_patient`).
  `prune` does not touch it. The card prints `charted_by` **only when the store's `at` equals `charted_at`**; otherwise
  (a device value, a backdated row older than the latest) it is `null` and the box prints the time alone — the card
  never names the wrong person.
- `api/rehydrate.py`: a replayed `chart` row whose subject is an isolation code also notes `charted_by` and `obs_ts`
  in the store. A rebuild after a «hatalı giriş» of another value does not touch it (the flags are not withdrawable).
- **No audit read is added** (so no index: migration 0021's `ix_audit_tenant_patient_id` would serve one if the
  review moves «kim» to a per-patient read).
- `dashboard/src/liveAdapters.js` `patientFromBoard`: `isolation: entry?.isolation ?? null`.

**Why the card carries the flags.** `GET /infection` is built from the scoped cards with no reference to the engine
(Eczane's builder shape); the patient-screen box reads the board; and a save made elsewhere reaches an open box
through the board's own stream. One small block per card; no other screen draws it in this slice.

### D9 — the key `infection.view`

- Engine `PERMISSIONS`, appended after `workload.view` (the last key): `"Open the Enfeksiyon kontrol page: per patient
  in one's own units — isolation, suspected infection, the antibiotic clock and open sepsis alarms — and the isolation
  beds, read-only (GET /infection)"`. 30 → **31** keys.
- Default groups: `_ATTENDING` (so `attending` and `unit_physician`), the `physician`, `charge_nurse` and `nurse`
  tuples. Not `pharmacist`, `rapid_response`, `auditor`, `platform_support`, `biomedical`.
- Mirrors, in the same order (after `workload.view`): `catalogue.js` `PERMISSION_KEYS`, `admin.testutil.js`
  `PERMISSION_TEXTS` (the backend's sentence), `i18n/strings/perms.js` `infection: { view }` in four languages (tr
  «“Enfeksiyon kontrol” sayfasını açar: kendi birimlerindeki hastaların izolasyonunu, şüpheli enfeksiyonu,
  antibiyotik süresini, açık sepsis alarmlarını ve izolasyon yataklarını salt okunur görür»).
- Charting a flag needs `clinical.chart` (the door's key), not `infection.view`: the page writes nothing.
  `clinical.chart`'s description is unchanged («…» already covers it).

### D10 — engine: `GET /infection`

Guard `infection.view`; in `api/app.py` after `/pharmacy`: `caller, scope, result = await _board_for(authorization,
INFECTION_VIEW)`, then the ward structure (D11), then the pure builder `ward_infection(result.boards, structure, scope,
now=…)` in a new `api/infection.py`, plus `/patients`' own `scope` and `scope_note`. Refusals, in order: 401; 403
`permission required: infection.view`; 503 «kapsam şu anda okunamıyor» (`_board_for`); **503 «yatak yapısı şu anda
okunamıyor»** when the structure source raises (an inline `detail=` literal, so `apiErrors.test.js`' sweep of
`api/app.py` finds it). A device token passes, as on every board route (Eczane's O6). **Not audited** (as `/pharmacy`,
`/patients`, `/tasks`: a poll would bury the trail). `now` is taken right after the board was built (as `/pharmacy`).

Answer (synthetic values):

```json
{"now": "2026-11-12T09:30:00+00:00",
 "antibiotic_window_min": 60, "antibiotic_window_source": "surviving-sepsis-campaign-2026",
 "counts": {"patients": 5, "isolated": 2, "suspected": 2, "clock_missed": 1, "sepsis_open": 1,
            "isolation_beds": {"defined": true, "total": 3, "free": 1, "occupied": 1}},
 "units": [{"unit_id": "u1", "unit_name": "YBU-1",
            "counts": {"patients": 5, "isolated": 2, "suspected": 2, "clock_missed": 1, "sepsis_open": 1,
                       "isolation_beds": {"defined": true, "total": 3, "free": 1, "occupied": 1}}}],
 "isolated": [
  {"patient_id": "S-101", "bed_label": "İzo 1", "bed_id": "b9", "unit_id": "u1", "display_name": "Ayşe Sentetik",
   "isolation": {"state": "isolated", "types": ["contact", "droplet"], "charted_at": "2026-11-12T08:10:00+00:00",
                 "charted_by": "hemsire.sentetik"},
   "in_isolation_room": true, "suspected_infection": true,
   "antibiotic": {"state": "met", "given": true, "given_at": "2026-11-12T06:40:00+00:00",
                  "recognized_at": "2026-11-12T06:00:00+00:00", "deadline": "2026-11-12T07:00:00+00:00",
                  "remaining_sec": null},
   "sepsis_alarms": []},
  {"patient_id": "S-104", "bed_label": "YBU 1-4", "bed_id": "b4", "unit_id": "u1", "display_name": "",
   "isolation": {"state": "isolated", "types": ["contact"], "charted_at": "2026-11-11T22:00:00+00:00",
                 "charted_by": null},
   "in_isolation_room": false, "suspected_infection": null,
   "antibiotic": {"state": "none", "given": null, "given_at": null, "recognized_at": null, "deadline": null,
                  "remaining_sec": null},
   "sepsis_alarms": []}],
 "suspected": [
  {"patient_id": "S-103", "bed_label": "YBU 1-3", "bed_id": "b3", "unit_id": "u1", "display_name": "Ali Sentetik",
   "isolation": {"state": "unrecorded", "types": [], "charted_at": null, "charted_by": null},
   "in_isolation_room": false, "suspected_infection": true,
   "antibiotic": {"state": "missed", "given": null, "given_at": null,
                  "recognized_at": "2026-11-12T08:05:00+00:00", "deadline": "2026-11-12T09:05:00+00:00",
                  "remaining_sec": -1500},
   "sepsis_alarms": [{"kind": "septic_shock", "severity": "critical",
                      "first_seen_at": "2026-11-12T08:20:00+00:00", "resolved_at": null}]},
  {"patient_id": "S-101", "…": "the same row as above"}],
 "beds": [
  {"bed_id": "b9", "bed_label": "İzo 1", "room_name": "İzolasyon 1", "unit_id": "u1", "bed_state": "OCCUPIED",
   "state_reason": null, "tile": "isolated",
   "occupants": [{"patient_id": "S-101", "display_name": "Ayşe Sentetik", "types": ["contact", "droplet"]}]},
  {"bed_id": "b10", "bed_label": "İzo 2", "room_name": "İzolasyon 1", "unit_id": "u1", "bed_state": "AVAILABLE",
   "state_reason": null, "tile": "free", "occupants": []},
  {"bed_id": "b11", "bed_label": "İzo 3", "room_name": "İzolasyon 2", "unit_id": "u1", "bed_state": "BLOCKED",
   "state_reason": "ISOLATION_CLEANING", "tile": "out_of_service", "occupants": []}],
 "scope": {"unrestricted": false, "reason": "assigned", "unit_ids": ["u1"], "bed_ids": [], "own_patients": 0,
           "hidden": 0, "unresolved_hidden": 0, "unmatched_unit_ids": [], "unmatched_bed_ids": [], "blind": false},
 "scope_note": null}
```

- **Rows.** A row is one scoped card. `isolated` holds the cards whose `isolation.state` is `isolated`; `suspected`
  the cards whose `sepsis.suspected_infection` is `true`. A patient in both is in both. Row fields: bed and name as
  Eczane's `row_of` (`identity.bed_label` else empty, `display_name` else empty, `bed_id`, `unit_id`); `isolation`
  without the four raw flags; `antibiotic` = **`pharmacy.antibiotic_of(card.meds)`** (the same object `/pharmacy`
  answers for that card — reused, not copied); `sepsis_alarms` = the card's alerts of the three kinds `septic_shock`,
  `sepsis`, `under_resuscitated_sepsis` (in that order), firing ones (`resolved_at` null) and latched ones
  (`resolved_at` set). `antibiotic_due` / `antibiotic_overdue` are not listed there (the antibiotic cell says it);
  `sepsis_watch` is not (a model's early warning with its own source, not one of the three rule kinds).
  `in_isolation_room`: `true` / `false` when the card's `bed_id` is / is not a bed of a room with `is_isolation` (any
  such bed of the tenant, open or not), `null` when the card has no `bed_id`.
- **Order.** `isolated`: unit id (no unit last), then the bed label (else the patient key) in Eczane's natural order,
  then the key. `suspected`: (0) `running` / `missed` by `remaining_sec`, least first; (1) a firing alarm of the three
  kinds; (2) the rest; inside a group the same bed order. Eczane's bed order (`_natural` and `sort_key`'s unit rule)
  becomes one public helper in `api/pharmacy.py` that both import; `/pharmacy`'s order and tests are unchanged.
- **Tiles** (`beds`). One per **open** bed of an **open** room with `is_isolation` in an **open** unit, in the caller's
  reach: unrestricted, or the unit in `scope.unit_ids`, or the bed in `scope.bed_ids` (the board scope, normalised —
  `/tenant/structure`'s `shown` rule; a `structure.manage` holder gets no wider view here). `tile`, decided by the
  server from `bed_state` and the scoped cards whose `identity.bed_id` is the bed:

  | `bed_state` | occupants on the scoped board | `tile` | TR words |
  |---|---|---|---|
  | AVAILABLE | — | `free` | «boş» |
  | OCCUPIED, PENDING_DISCHARGE, PENDING_TRANSFER_OUT | one is `isolated` | `isolated` | «izolasyonlu hasta» + the types + the name |
  | same | all `not_isolated` | `not_isolated` | «izolasyonsuz hasta» + the name |
  | same | otherwise (one or more `unrecorded`) | `unrecorded` | «izolasyon kaydı yok» + the name |
  | same | none | `occupant_unseen` | «dolu» and «—» «hasta bu listede yok» |
  | HOUSEKEEPING | — | `cleaning` | «temizlikte» |
  | RESERVED | — | `reserved` | «rezerve» |
  | BLOCKED | — | `out_of_service` | «kullanım dışı · {neden}» (Doluluk's `doluluk.reason.*`: «İzolasyon temizliği» …) |
  | MAINTENANCE | — | `maintenance` | «bakımda» |

  The prototype's «bloke» is the live system's «kullanım dışı» (G2-B3a D4); `ISOLATION_CLEANING` is its reason, not
  «temizlikte». `occupants`: `{patient_id, display_name, types}` of each card on the bed (normally one). The state note
  (`beds.state_note`, encrypted, may name an expected patient) is never read. Order: unit name, room name, bed label
  (natural).
- **Counts** (`counts` over the whole answer; `units[].counts` per unit; a row on no unit counts only in `counts`):
  `patients` = scoped cards; `isolated`, `suspected` = rows of the two lists; `clock_missed` = cards whose antibiotic
  state is `missed`; `sepsis_open` = **patients** with at least one firing alarm of the three kinds (a latched one is
  shown, not counted); `isolation_beds`: `total` = tiles, `free` = `free` tiles, `occupied` = tiles whose `bed_state` has
  a patient (OCCUPIED and the two pending states, as `occupancy.js` `WITH_PATIENT`), `defined` = `total > 0`.
- **`units`**: every open unit the scope reaches as a unit (unrestricted: all), plus the unit of any row or tile, by
  name; `unit_name` from the structure, `null` when the structure does not know the id.
- A scoped board with no card still answers the whole shape (empty lists, zero counts, the tiles of its reach).

### D11 — engine: the ward structure source

`app.py` has no database session; a route that needs the database reads through an injected store (`tasks`,
`readings`, `device_beds`). So: a `WardStructure` protocol in `api/infection.py` — `read(tenant) ->
StructureSnapshot(units: [(id, name, is_active)], isolation_beds: [(bed_id, label, is_active, state, state_reason,
room_id, room_name, room_active, unit_id)])`, keyed by the hospital slug as `TaskStore` is; `InMemoryWardStructure`
(tests, the dev server; empty by default); `PostgresWardStructure(url, ssl_required)` in a new
`api/infection_postgres.py` (sync engine, `tasks_postgres.py`'s shape: two statements, the tenant's units, and the beds
of its rooms with `is_isolation`, joined through rooms, units and sites to `tenants.slug`; never `state_note`).
`create_app(..., ward_structure=None)` defaults to the in-memory one; `prodserver.py` `_ward_structure(url)` picks
Postgres in production (`_tasks`' rule). It runs on the event loop like `tasks.settings` (Eczane's O9 applies).

### D12 — route tables

`/pharmacy` is in exactly five lists, and `/infection` joins the same five: `BOARD_EXPECTED`
(`tests/test_board_permissions.py`, 28 → 29 entries: `("GET", "/infection"): "infection.view"`); the board-Caller set
in `UNSCOPED_BY_DESIGN` (`tests/test_tenant_isolation.py`); `API_PATHS` (`tests/test_nginx_routes.py`, 35 → 36);
`deploy/local/web/nginx.conf`'s API location regex (`|infection`); `dashboard/vite.config.js`'s proxy (`"/infection"`).
Neither is in `tests/test_route_permissions.py` `EXPECTED` (77, router modules only; unchanged) nor in the access-log
map (no parameter, no patient key: `default $uri`; `test_access_log_redaction.py` passes unchanged).

### D13 — the page `/enfeksiyon` «Enfeksiyon kontrol»

Route `{ id: "enfeksiyon", path: "/enfeksiyon", icon: "shield", labelKey: "enfeksiyon.nav", shortKey:
"enfeksiyon.navShort", perms: ["infection.view"], work: true, nav: "main" }`, after `isyuku`, before `settings`: tail
`["eczane","ozet","kalite","isyuku","enfeksiyon","settings"]` (the pinned tail moves into this route's block of
`routes.test.js`). `shield` is in `ui/icons.js` and used by no route (the prototype's icon). Nobody's home moves; a
session holding `infection.view` alone lands here. Three lines in `routes.js` (`lazyScreen`, `SCREENS`, `ROUTES`).

1. **Header:** «Enfeksiyon kontrol»; the line «İzolasyon, şüpheli enfeksiyon, antibiyotik süresi ve sepsis
   alarmları»; a unit filter («Tüm birimler» / each of `units`); «{HH:MM} itibarıyla» (the answer's `now`); «Yenile».
   The filter selects among the server's per-unit counts and filters the lists and tiles by `unit_id`; it reads
   nothing. A selected unit that a new answer no longer lists falls back to «Tüm birimler» with «Seçili birim artık
   kapsamınızda değil.»
2. `ScopeNote` from the answer's `scope` / `scope_note`; the stale or failed alert (D15).
3. **Cards:** «izolasyondaki hasta» (`isolated`) · «boş izolasyon yatağı» («{free} / {total}») · «şüpheli enfeksiyon»
   (`suspected`) · «antibiyotik süresi aşan» (`clock_missed`) · «açık sepsis alarmı olan hasta» (`sepsis_open` —
   patients, so the words say so).
4. **«İzolasyondaki hastalar»:** Yatak · Hasta · Birim · İzolasyon (the types as tags, «Temas · Damlacık», then «son
   kayıt {saat}») · Oda («izolasyon odası» / «izolasyon odasında değil»). Empty: «Kapsamınızda izolasyondaki hasta
   yok.» Under it: «İzolasyon, bir klinisyenin hasta ekranından bu sisteme kaydettiği önlem türleridir; sistem
   izolasyon önermez, türünü seçmez. “İzolasyon kaydı yok”, kayıt yapılmadığını söyler; hastanın izolasyonda olmadığı
   anlamına gelmez.»
5. **«İzolasyon yatakları» «{a} dolu · {b} boş»** (`occupied`, `free`): the tiles — bed label, room, the words of D10's
   table, the name and the types for a patient. No tile is coloured as a judgement; the types are Doluluk's warn tags.
   No tile: «Kapsamınızda izolasyon odası tanımlı değil.»
6. **«Şüpheli enfeksiyon»:** Yatak · Hasta · Birim · Antibiyotik (Eczane's cell: `pharmacyModel.antibioticCell`, its
   words `eczane.ab.*` / `eczane.noRecord`, its tones — `missed` crit, `running` high, the engine's severities) · Sepsis
   alarmı (each listed alarm by kind — «Septik şok», «Sepsis», «Yeterli sıvıdan önce hipoperfüzyon» (the engine's own
   summary of `under_resuscitated_sepsis`, in Turkish) — toned by its `severity`; a latched one adds `alarms.resolvedUnacked`
   «geçti · onaylanmadı»; none: «Açık sepsis alarmı yok»). Empty: «Kapsamınızda şüpheli enfeksiyon kaydı olan hasta
   yok.» Under it, Eczane's two lines as they are: `eczane.note` («“Kayıt yok” … verilmediği anlamına gelmez.») and
   `eczane.source` (the 1-hour window: the engine's recognition rule, Surviving Sepsis Campaign 2026, strong
   recommendation on very low certainty evidence — [[surviving-sepsis-campaign-2026]], [[antimicrobial-timing-sepsis]],
   as Eczane D9 cites them).
7. **The honesty note** (always, in every state): «Bu sayfada yok: cihaz günleri (santral kateter, üriner kateter,
   ventilatör), cihaz kullanım oranı, enfeksiyon oranları, antibiyotik günü ve kültür sonuçları — hiçbirinin bu
   sistemde kaynak kaydı yok; hiçbiri hesaplanmadı. Enfeksiyon tanımları ve olay sayımı hastanenin enfeksiyon kontrol
   komitesinden gelir; sistem eşik ya da tanım üretmez. Homunculus tanı koymaz, order vermez.» The prototype's two
   formulas (utilisation, per-1000-device-day rate) are **not** carried: no vault source states them, and a formula
   for a number the page cannot compute adds nothing a clinician can use.

**Names** are shown (every default holder is a clinician of the unit). The bed and the name are one link to
`#/patients/<key>` for a session with `board.view` (Eczane D5); an empty name prints `board.identityPending`. The Hasta
column on a tile and in the tables is the same `nameOf`.

### D14 — reading: Eczane's tempo

A shared hook: `usePharmacy`'s body becomes `screens/common/useWardList.js` `useWardList(store, read, isAnswer, {
everyMs })`; `usePharmacy` is it with `api.pharmacy()` (its tests unchanged) and `useInfection` with `api.infection()`
(a malformed answer — `counts` not an object, or `isolated` / `suspected` / `beds` / `units` not arrays — is a failed
read). Every **30 s** (`PHARMACY_TICK_MS`), at once when a hidden tab is shown, nothing from a hidden tab; the
sequence guard; a 401 / 403 drops the held answer, a 5xx / timeout / network failure keeps it. Fresh = Eczane's rule
(`isFresh`, 90 s). The page's clock = `useNow(10_000)` + `clockSkewOf(board skew, own skew)` (Eczane D17).

**Why not the summary pages' 60 s nor the board's stream.** The page carries Eczane's running clocks and alarm state,
read by the ward, and Eczane's 30 s is the established tempo for those very cells (a `running` that passes its deadline
reads «<1 dk kaldı» until the next answer: 30 s, not 60). The board's stream sends a frame per reading per patient; a
server-built ward list re-read on each frame would read the whole list for every vital sign. The summary pages' 60 s
suits counts nobody acts on minute by minute.

### D15 — Decision 18, every cell

«Fresh» is D14's. «No answer» = loading, a first read that failed, a refused read (dropped), a malformed answer.

| Cell | Source | Fresh answer | Not fresh (answer held) | No answer |
|---|---|---|---|---|
| «{HH:MM} itibarıyla» | `now` | the time | «son yanıt {saat}» in the crit alert «Enfeksiyon listesi güncel değil · son yanıt {saat}» (+ the read's reason) | nothing; «Enfeksiyon listesi okunuyor…» / «Enfeksiyon listesi okunamadı: {neden}» |
| Each of the four count cards | `counts` / `units[].counts` | the number, 0 included | n > 0: the number under «son yanıt {saat} itibarıyla»; **0: «—» «liste güncel değil»** | not drawn |
| «boş izolasyon yatağı» | `isolation_beds` | «{free} / {total}»; `defined` false: «—» «izolasyon odası tanımlı değil» | as the other cards (a 0 free is «—») | not drawn |
| Yatak | `bed_label` else `patient_id` | always a value | same | — |
| Hasta | `display_name` | the name, else `board.identityPending` | same | — |
| Birim | `units[]` by `unit_id` | the name; no `unit_id`: «—» «birimi belli değil»; unknown id: «—» «birim adı okunamadı» | same | — |
| İzolasyon | `isolation.types`, `charted_at`, `charted_by` | the types; «son kayıt {kim} · {saat}» or «son kayıt {saat}» | same (a record with its own time) | — |
| Oda | `in_isolation_room` | the two words; `null`: «—» «yatağı bilinmiyor» | same | — |
| Antibiyotik | `antibiotic` | Eczane's fresh cell | Eczane's stale twins («Son yanıtta süre işliyordu / aşılmıştı · bitiş {saat}») | — |
| Sepsis alarmı | `sepsis_alarms` | the kinds; none: «Açık sepsis alarmı yok» | the kinds as «son yanıtta: {tür}»; none: «—» «liste güncel değil» | — |
| Table bodies, empty | `isolated`, `suspected` | the two empty sentences | no table: «—» «liste güncel değil» | no table |
| «{a} dolu · {b} boş» | `isolation_beds` | the numbers | n > 0 as cards; a 0: «—» | not drawn |
| A tile | `beds[].tile` | D10's words; `occupant_unseen`: «dolu» and «—» «hasta bu listede yok» | the same words under the alert | not drawn |
| No tiles | `beds` | «Kapsamınızda izolasyon odası tanımlı değil.» | «—» «liste güncel değil» | — |
| A `tile` or `state` this build does not know | — | the server's own word (`enfeksiyon.unknown`), never «boş» | same | — |

A refused read (401 / 403) leaves no card, no table, no tile and no name on the page. The honesty note and the
isolation-record note stay in every state.

### D16 — the patient screen's «İzolasyon» box

A new `screens/patient/IsolationBox.jsx`, drawn right after the Sepsis box (`PatientScreen.jsx` 504), in its column.

- **State line** from the card's `isolation` (null = `unrecorded`): `isolated` «İzolasyon: {türler}»; `not_isolated`
  «Açık izolasyon kaydı yok: son kayıtta hiçbir tür işaretli değil.»; `unrecorded` «İzolasyon kaydı yok: bu hasta
  için bu sisteme hiç izolasyon kaydedilmedi.» **While the board is not LIVE** (`boardKnown`): an isolated state keeps
  its types with «· pano güncel değil»; the two «yok» sentences become «İzolasyon durumu gösterilemiyor — pano güncel
  değil.» (Decision 18). The screen's `BoardStrip` already says why.
- **Last record:** «Son kayıt: {kim} · {saat}» (`charted_by`, `charted_at`), «Son kayıt: {saat}» when `charted_by` is
  null, nothing when `charted_at` is null. The codebase shows who and when for other hand records (the Sıvı box's
  entries, the SOFA box's last signature).
- **Toggles** (only for `clinical.chart`): four labelled checkboxes in `ISOLATION_CODES` order (the admin forms'
  native checkbox), seeded from the card (`true` → checked; `false` / `null` → unchecked); «Kaydet» sends all four,
  `board.store.chart(id, [{code: "isolation_contact", value: 1|0}, …])`, no time. «Kaydet» is always offered — a
  save of an unchanged set records it again, with a new time (the suspected-infection buttons likewise offer both
  answers even once one was charted); a save of four unchecked boxes on an `unrecorded` patient records «no isolation».
  The note: «Klinik bir kayıttır, öneri değil: adınızla ve saatiyle denetim kaydına yazılır. Geri alınmaz — yeni bir
  kayıt üstüne yazar. İzolasyonu bitirmek için dört türün işaretini kaldırıp kaydedin.» Without the key: «Bu kaydı
  yapma yetkiniz yok (clinical.chart).» and no checkbox.
- **Draft.** Untouched, the checkboxes follow the card. Once touched they keep the draft until a save or «Vazgeç»; if
  the card's `charted_at` changes meanwhile: «Bu arada yeni bir izolasyon kaydı geldi ({kim} · {saat}); kaydederseniz
  sizin seçiminiz geçerli olur.» A move to another patient resets draft and busy state (the shell keeps the screen
  mounted; the suspected-infection rule).
- **Answers**, as the suspected-infection buttons, with the fluid dialog's two refinements: busy while in flight, one
  at a time, no `disabled`, `Announce` «İzolasyon kaydediliyor…»; success: toast «İzolasyon kaydedildi.» and the draft
  re-seeds from the reloaded card; `answer.dropped` (a discharged number): warn toast «{subject} taburcu edilmiş;
  izolasyon kaydedilmedi.»; a refusal (400 / 403 / 404 / 503): error toast «{subject}: izolasyon kaydedilmedi —
  {neden}» (`apiErrorText`); no answer (`mayHaveLanded`: timeout, network): «{subject}: yanıt gelmedi; kaydedilmiş
  olabilir — birazdan İzolasyon kutusuna bakın.» The draft is kept on every failure. `{subject}` is the bed label else
  the key — never the name (Decision 14). The door answers 400, not 422, for a refused entry.
- `patient.onlyWrite` (four languages) names six things: «… şüpheli enfeksiyon işareti, izolasyon kaydı, hastanın
  normali …».

### D17 — audit

No new audit type: a save writes four `chart` rows (subject = the code, payload `{value, unit, obs_ts, charted_by}`,
`api/clinical.py` `chart_observations`). `/denetim`'s `EVENT_TYPES` (61) and `engineTypes.test.js` need nothing; a
`chart` row of an isolation code shows its subject as the code, as every chart row does. `GET /infection` writes
nothing; opening a patient from a row writes the patient screen's usual `view`.

### D18 — i18n

- `dashboard/src/live/i18n/strings/enfeksiyon.js`, four languages, and the catalog's import and entry lines. Nav: tr
  «Enfeksiyon kontrol» / short «Enfeksiyon», az «İnfeksiya nəzarəti» / «İnfeksiya», ru «Инфекционный контроль» /
  «Инфекции», en «Infection control» / «Infection» (the prototype's `m_infection`). Types: tr «Temas», «Damlacık»,
  «Solunum», «Koruyucu»; az «Təmas», «Damcı», «Hava yolu», «Qoruyucu»; ru «Контактная», «Капельная», «Воздушная»,
  «Защитная»; en «Contact», «Droplet», «Airborne», «Protective» (the prototype's `iso_*`). Kinds (D13.6), tile words
  (D10), the notes (D13), the Decision 18 reasons (D15), `unknown`.
- `patient.js`: `patient.isolation.*` (D16) in four languages; the box reads the types from `enfeksiyon.type.*`.
- `errors.js` + `apiErrors.js`: «yatak yapısı şu anda okunamıyor» → `structureUnreadable`, four languages.
- Reused as they are: `eczane.ab.*`, `eczane.noRecord`, `eczane.note`, `eczane.source`, `eczane.dur.*`,
  `doluluk.reason.*`, `alarms.resolvedUnacked`, `board.identityPending`, `ScopeNote`'s strings.
- `AZ_SAME_AS_TR` (`strings.test.js`): any key whose AZ equals TR after review, likely `kind.sepsis` «Sepsis» and
  `kind.septicShock` «Septik şok».
- `rawKeys.test.jsx` sweeps the new screen (a fresh answer with an isolated row, a suspected row in `missed` with a
  firing septic shock, one tile of each state) and the box.

### D19 — not in this slice

Device days, device utilisation, infection rates, antibiotic days, cultures and any formula for them; an isolation
recommendation, a threshold or a link between a culture or a diagnosis and an isolation type; marking an existing room
as an isolation room (O1); an isolation tag on the bed cards, the alarm rows or Doluluk's tiles; an isolation reason
or free text; isolation history views; using isolation for bed assignment or transfer; notifications; printing or
export; any write from the page.

### D20 — guide

`docs/homunculus-rehber-TR.md`: a new **§3.28 «Enfeksiyon kontrol»** (what the page shows and does not, who sees it,
the box, Decision 18's words, the deploy note), and §3.5's «30 sabit anahtar … en yenisi `workload.view`» becomes
«31 … en yenisi `infection.view`, «Enfeksiyon kontrol», §3.28». The roadmap row for G4-05 in
`docs/superpowers/plans/2026-10-01-tasarim-entegrasyonu-yol-haritasi.md`.

### D21 — the migration

`0023_infection_view`, `revision = "0023"`, **`down_revision = "0021"`** (the head of main today: the chain is
… 0020 → 0022 → 0021). One statement per `op.execute` (0019's shape): `GROUPS = ("attending", "unit_physician",
"physician", "charge_nurse", "nurse")`; `INSERT INTO group_permissions (group_id, permission) SELECT id,
'infection.view' FROM groups WHERE slug IN (…) ON CONFLICT DO NOTHING`; downgrade deletes the key's rows. No table,
no column. Purely additive: an older image serves against it (a key its catalogue does not know never reaches a token).

**Numbering rule (agreed with Lane A).** The TRƏS branch (`feat/tres-esaglik`) also plans `0023` on `0021`. Whichever
reaches main first takes `0023`; the second is renumbered onto the head at that moment (e.g. `0024`, `down_revision =
"0023"`) — one line in the migration and the tuple in its test, because the tests check the head by ancestry
(`ScriptDirectory.iterate_revisions(head, "base")` contains the revision), never by the names' order.

### D22 — deploy

api + web together, and `alembic upgrade head` (0023: rows only), on the owner's «main'e al» and «onay» — as its own
release or folded into the combined one. **Not web before api:** an older api refuses the new codes with 400
«bilinmeyen klinik alan» and has no `/infection`. The web image carries `nginx.conf`. Rollback: downgrade `0023` from
this release's image, then the previous tags. The isolation `chart` rows stay in the trail: an older api's replay
skips their unknown slug (`rehydrate.observation_of`), so the flags vanish from that api's board and come back,
replayed, with the next deploy of this one. Hub, bridge, nce untouched. Rights travel in the token: a session opened
before the deploy sees the page once its token is renewed. Rooms already in the structure carry `is_isolation` only if
they were created with it (O1).

## 4. Tests

**Engine (no DB):**
- `tests/test_infection.py` (pure): the three isolation states and `types` order; rows of both lists, a patient in
  both; `antibiotic` equal to `pharmacy.antibiotic_of` for the same card; `sepsis_alarms` (three kinds, latched
  listed and not counted, `sepsis_watch` and the antibiotic kinds absent); `in_isolation_room` true / false / null;
  both orders; tiles for every bed state, BLOCKED with `ISOLATION_CLEANING`, `occupant_unseen`, two cards on one bed,
  closed bed / room / unit not drawn; reach (unit grant, bed grant, own patients only, unrestricted); counts whole and
  per unit (a no-unit row only in the whole), `defined` false; `units` (reach plus rows and tiles, unknown name null);
  no card → the whole shape.
- `tests/test_infection_api.py`: 403 without the key, 200 with it alone; the device token; `scope` and `scope_note`;
  503 for an unreadable scope and 503 «yatak yapısı şu anda okunamıyor» for a failing source; nothing appended to the
  audit; an identity-only card; two hospitals with the same keys and bed labels each read their own; a save through
  `POST /clinical` then `GET /infection` shows the row with `charted_by`; all four to 0 removes it; a discharged
  patient is gone.
- Chart door (`tests/test_api_clinical.py` or a new `test_isolation_chart.py`): the four codes take 0 / 1 / true /
  false, refuse 0.5; unit "bool"; `recorded_at` ahead → `AT_FUTURE`, 25 h back → `AT_TOO_OLD`; the withdrawal refuses
  them (`RETRACT_NOT_BEDSIDE`); nothing filed in the readings record.
- The card (`tests/test_api_board*.py`): the `isolation` block per flag three-valued, `state`, `types`, `charted_at`,
  `charted_by`; `charted_by` null for a backdated row older than the latest and for a device value; identity-only card
  `isolation: null`.
- `AckStore`: `isolation_charted` keeps the newest `at`; `forget_patient` clears it; `prune` leaves it.
- Replay: flags and `charted_by` restored after a restart; a discharge row forgets them; an unknown slug still skipped.
- `tests/test_canonical.py` (the four names); `tests/test_permissions.py` (31 keys, `SPEC_GROUPS` for the five
  groups, the last key `infection.view`); `test_board_permissions.py`, `test_tenant_isolation.py`,
  `test_nginx_routes.py` (D12); the access-log test unchanged.
- `tests/test_migration_0023_infection_view.py`: without a database, `(revision, down_revision, KEY)` and `GROUPS` ==
  the non-system holders in `DEFAULT_GROUPS`; on the real chain, the five groups of every tenant get the row and
  `pharmacist`, `rapid_response`, `auditor` and a hospital's own group do not; idempotent; downgrade removes the rows
  and leaves the groups; the head checked by ancestry.
- `PostgresWardStructure` (DB): only the tenant's units and isolation-room beds, with state and reason, never the note.

**Dashboard:**
- `infectionModel.test.js` (pure): the selection (whole and per unit; a no-unit row only under «Tüm birimler»);
  every row of D15 (fresh, not fresh with a 0 and with n > 0, no answer, `defined` false); tile words; the alarm cell
  fresh and stale, latched; Oda and Birim cells; an unknown `tile`.
- `useWardList` / `useInfection` / `usePharmacy` tests: `usePharmacy`'s cases unchanged; `useInfection`'s malformed
  shapes.
- `EnfeksiyonScreen.test.jsx`: header, filter (and its fallback), the five cards, both tables in the server's order,
  tiles, the notes (honesty, isolation record, `eczane.note`, `eczane.source`), links only with `board.view`, the
  empty sentences only when fresh, stale, failed first read, the structure 503, a refused read leaves no name.
- `IsolationBox.test.jsx`: seeded checkboxes, the four entries in order, busy and `Announce`, success, refusal naming
  the bed, `dropped`, `mayHaveLanded`, the draft kept on failure, no key → no checkbox, `isolation: null`, not LIVE →
  no «yok», «Son kayıt» with and without who, the newer-record note, a patient switch resets.
- `liveAdapters` (`isolation` passed through); `routes.test.js` (the entry, the tail of six, `infection.view` alone
  lands on `/enfeksiyon`, the pharmacist and the auditor cannot reach it, the nurse's home stays `/beds`); the catalogue
  drift tests; `strings.test.js`; `enfeksiyon.strings.test.js` (four languages, the TR word for word, no formula, no
  «izolasyonsuz» for an unrecorded patient); `rawKeys.test.jsx`; `apiErrors.test.js` (the new 503).

**Gates:** the engine's no-DB suite; the DB tests that touch the migration, the structure source and tenant isolation
on a throwaway Postgres on 127.0.0.1:5644x; the Python 3.14 slice; the whole dashboard suite; `vite build` (one more
lazy chunk; the precache count recorded).

**Open items.**
- **O1 (owner).** An existing room cannot be marked as an isolation room (`RoomPatch` has no `is_isolation`); on a
  structure built without the flag, the bed section reads «Kapsamınızda izolasyon odası tanımlı değil.» until rooms are
  created with it. Adding the field to Yönetim › Yapı's room edit is a `structure.manage` write with its own audit row
  (carried in `structure.rename` as `room_number` is, or a new type) — this slice or later?
- O2. AZ, RU and EN texts await a native reading, as every namespace.

## §5 Değişiklikler (inceleme sonrası)

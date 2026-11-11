# G3-04 · Pharmacy page («Eczane sayfası») — design

Group 3, slice 4 (roadmap `2026-10-01-tasarim-entegrasyonu-yol-haritasi.md`, Grup 3: «eczane»; carried behaviour
`pharmacyView`, line 664). Lane A. Owner's decisions of 2026-11-11: «evet» (the slice), scope **A** («a maddesi
uygundur.»: a read-only ward page built only from what the system already holds), the design («1- evet»),
this written spec with O1–O3 as it words them («2 evet»). Builds on
G2-A3 (the Meds chart and the board's `meds` block), G2-A1 (the antibiotic clock's anchor), G3-02 (task settings: shift
start, tenant zone; the `_board_for` reader), G3-03 (the fluid ledger) and the Group 1 shell. Branch `feat/g3-eczane`,
cut from main `e0850fb1` and merged with the main that carries G2-B1c (migration `0018`) and G4-02 («Yönetici özeti»).
Guide section at implementation: §3.23.

## 1. Why

The pharmacist group has existed since the RBAC slice and reaches no screen of its own: it holds `board.view` and
`admissions.view` and sees what everyone sees. The board card has carried a medication block «written for the
pharmacist» since G2-A3 (`api/board.py` `_meds`: vasopressor rates and when each was charted, the three-valued
antibiotic record, the antibiotic clock, creatinine), but it is read one patient at a time, on the patient screen.
The roadmap's carried rule says what the page is: «Eczacının kendi sayfası vardır (antibiyotik saati, doz önermez,
"kayıt yok"u "verilmedi" diye göstermez); eczacı ve sorumlu hekim görür, hemşire görmez».

This slice puts that picture on one ward page: every patient in the caller's scope in one table, the antibiotic
clocks that are running or passed first. It adds no data entry, no table and no clinical rule. The one sourced
number on the page is the engine's existing 1-hour antibiotic window (`rules/antibiotic_clock.py` `WINDOW`), whose
source in the vault is [[surviving-sepsis-campaign-2026]] (authority high, `capture: extract`): antimicrobials within
1 hour for septic shock and for sepsis without shock — both strong recommendations on very low certainty evidence
([[antimicrobial-timing-sepsis]]). The page names the source with both halves (strong, very low certainty), as the
concept article asks. Creatinine and the fluid balance are a number and its time, nothing more: the vault holds no
renal-dosing threshold and no fluid-balance target, so the page judges neither. Homunculus does not diagnose, order
or advise a dose.

## 2. Decisions

| # | Decision | Why |
|---|---|---|
| D1 | **Read-only, from what exists.** The page is built from the scoped board cards (`identity`, `meds`) and the fluid ledger's `chart` rows. No new entry form, no new table, no new signal code, no new rule. | Owner's scope A. |
| D2 | **Permission `pharmacy.view`** (new catalogue key): open the page and read `GET /pharmacy`. Default groups: `pharmacist`, `attending`, `unit_physician`, `physician`; `hospital_admin` holds the whole catalogue by rule. `nurse`, `charge_nurse`, `rapid_response`, `auditor`, `biomedical`, `platform_support`: none. Grantable to any group in Yönetim › Roller. | The carried rule: the pharmacist and the physicians see it, the nurse does not. |
| D3 | **Scope is the board's.** The route reads through `_board_for(authorization, "pharmacy.view")` — the reader `/patients` and `/tasks` share: the caller's units and beds (`resolve_scope`), an unreadable scope is 503 «kapsam şu anda okunamıyor». The rows are exactly the cards `/patients` would answer that caller (a patient discharged through Kabul is a tombstone and is on neither). A pharmacist's units are assigned in Yönetim › Kullanıcılar like anyone's. The answer carries `/patients`' own `scope` block and `scope_note`, so an empty list can say why it is empty. | One scope rule; an empty list and a quiet ward must not look alike. |
| D4 | **One read, `GET /pharmacy`; the server computes everything**: each row's antibiotic state, the order of the rows, the four counters, the fluid-day totals. The browser sums, sorts and judges nothing; it formats times and durations (D17, §5.1). The route lives in `api/app.py` beside `/patients` and `/patients/{id}/fluids`; the builders are pure functions in a new `api/pharmacy.py` (G3-03's shape). A device token passes the permission check, as on every board route (`Caller.can`); it already reads the same fields at `/patients` (open item O6). | G2-A3 Decision 1: no clinical arithmetic in the browser. |
| D5 | **The row**: bed (`identity.bed_label`, else the patient key — the board's `bedNameOf` rule), patient (`identity.display_name`; when it is empty the screen prints what the board prints, `nameOf`'s `board.identityPending`), vasopressors/inotropes, the antibiotic state, creatinine, today's fluid balance. The bed and the name are one link to the patient screen (`#/patients/<key>`, a real anchor as on the alarm rows — not a click handler on the `<tr>`), drawn as a link only for a session that holds `board.view`. | The approved columns; the patient screen is where the detail and the charting are. |
| D6 | **Vasopressors/inotropes**: every drug of `meds.pressors` with a charted rate, its rate and when it was charted (`meds.pressors_at`). A rate > 0 is printed as running, a 0 as «durduruldu» — the Meds box's own two sentences (`patient.medsRunning`, `patient.medsStopped`), with the charted time written as an age («12 dk önce», `ageText`). `on_pressor` is the engine's (`meds.on_pressor`). No judgement on how old a rate is. | Same vocabulary as the Meds box; a rate without its time cannot say whether it is current (G2-A3 D5). |
| D7 | **The antibiotic state** is one of six, decided by the server from `meds.antibiotic_clock`, `meds.antibiotic_at` and `meds.antibiotic_given` (§3.1): `running` «Süre işliyor · n dk kaldı», `missed` «Süre aştı · n dk», `met` «Karşılandı · saat», `late` «Geç verildi · saat», `given` «Verildi · saat», `none` «Kayıt yok» (the three «saat» are the administration's charted time). The clock, its deadline and `met` are the engine's (`_meds`); the page adds no window of its own. | The approved states, in the engine's own fields. |
| D8 | **«Kayıt yok» is never «verilmedi».** `antibiotic_given` stays three-valued in the answer. `null` (nobody charted anything) and `false` (something was charted, but no administration that counts: a 0, or a dose stamped before recognition) are worded alike: by the clock when there is one (`running` / `missed`, with the second line «uygulama kaydı yok»), else «Kayıt yok» — the Meds box does the same (its `false` without a clock falls to `patient.antibioticUnknown`). No state, tile or note says «verilmedi». A fixed note above the table says what the words mean: «“Kayıt yok” ve “uygulama kaydı yok”, bu sisteme antibiyotik uygulaması kaydedilmediğini söyler; verilmediği anlamına gelmez.» | The carried rule; `_meds`' own docstring. |
| D9 | **Time zero and the window are the engine's, and the page says so.** The clock runs from `engine.recognized_at` — the first evaluation in which the engine's `sepsis` or `septic_shock` rule fired in this episode (`pipeline.py`) — for `ANTIBIOTIC_WINDOW` = 1 h. It keeps counting while the sepsis alert is off the board: the anchor is dropped only when suspected infection is charted absent while no recognition rule fires (and restored if recognition returns within 15 minutes, `ANCHOR_RESTORE_S`), or when the patient is retired at discharge. An administration charted at or after recognition answers the clock (`met` / `late`); it does not remove it. The page's source line: «Antibiyotik süresi: motorun sepsis ya da septik şok kuralının ilk tetiklendiği andan itibaren 1 saat — Surviving Sepsis Campaign 2026 (güçlü öneri, çok düşük kesinlikte kanıt).» | Hard rule 1; [[antimicrobial-timing-sepsis]]: time zero must be stated, and the strength and the certainty are two different things. |
| D10 | **Order** (server): (1) rows whose state is `running` or `missed`, least `remaining_sec` first — the longest passed first, then the least time left; (2) the other rows with `on_pressor`; (3) the rest. Inside a group, bed order as the board's (`screens/beds/order.js` `byBed`): unit id, a row on no unit last, then the bed label with digit runs compared as numbers and letters case-folded, then the patient key. | The approved order; one bed order in the product. |
| D11 | **Four counters** (server, `counts`): «Süre işliyor» (`clock_running`), «Süre aştı» (`clock_missed`), «Vazopresör / inotrop alan» (`on_pressor`), «Sepsis tanınan» (`recognized`: rows with a clock) with its second line «antibiyotik kaydı yok: n» (`recognized_no_record`). By the engine's rules a recognised patient with no counted administration is exactly a `running` or `missed` row, so `recognized_no_record` = `clock_running` + `clock_missed`; the approved fourth counter is therefore shown with the number it is a part of (open item O1). | The approved counters; a tile that only repeated the sum of its neighbours would say nothing. |
| D12 | **Creatinine**: the last value and its time, «1.4 mg/dL · 06:10». `_meds` carries the value only, so `_meds` gains `creatinine_at` (the observation's timestamp, as `pressors_at`). No colour, no threshold, no trend, no eGFR. | A value without its time cannot be read; the vault has no renal-dosing source. |
| D13 | **Fluid balance**: the current fluid day's intake − output (G3-03 D5: from `task_settings.shift_start_a`, default 08:00, in the tenant's zone), summed by the server with `api/fluids.py` `fluid_day` and `totals`. One tenant-wide read of the day's `chart` / `chart_retract` rows per request (not one per patient); withdrawn entries are in no sum. A patient with no entry in the day has `fluid: null` and reads «Bugün kayıt yok» — never «0 mL». Shown as the signed balance, intake, output and the last entry's time. No colour, no target. | The approved column; an uncharted day is not a zero balance. |
| D14 | **Tones mirror the engine's severities and nothing else**: `missed` is drawn `crit` and `running` `high`, the severities `rules/antibiotic_clock.py` gives `antibiotic_overdue` and `antibiotic_due`; every other state, creatinine and the fluid balance are neutral. Nothing is green. | The screen adds no judgement of its own (riskStyle's rule). |
| D15 | **No audit row for the list read**, as `/patients`, `/tasks`, `/patients/{id}/trends` and `/fluids` write none (a poll would bury the record). Opening a patient from a row is the patient screen's usual `POST /view`, which writes `view`. | The code's existing convention. |
| D16 | **Screen** `/eczane` (route id `eczane`, rail after `devir` and before `ozet` (G4-02's page; the rail then ends `eczane`, `ozet`, `settings`), icon `pill`, `perms: ["pharmacy.view"]`, `work: true`, `nav: "main"`). Header «Eczane» with «Bu ekran izleme içindir; doz önermez, order vermez.»; the counters; D8's note; the table; the source line (D9); the footer note (D19). The table scrolls sideways on a narrow screen (`ui/Table`). | The prototype's page, with the live system's data. |
| D17 | **Refresh** every 30 s (`usePharmacy`, the shape of `useTasks`). While the answer is fresh, the antibiotic durations and the vasopressor ages are computed from the server's ISO times against the board's skew-corrected clock (`useBoardNow`), so they move between polls; the state word is always the server's. | Ward tempo; G2-A2: the API sends the stamp, never an age. |
| D18 | **A list that is not fresh never reads as today's.** §6: a failed read keeps the last answer under «Eczane listesi güncel değil · son yanıt {saat}», durations are frozen and worded in the past tense, and nothing is called empty; with no answer at all the page says «Eczane listesi okunamadı» and draws no counter and no table. | Decision 18 (only a live answer may say «nothing»); G4-01's rule for a board that is not fresh. |
| D19 | **Out of this slice, and said on the page**: orders, allergies, cultures, the drug-interaction lookup, counting antibiotic treatment days, dose advice. Footer note: «Bu sayfada yok: order'lar, alerjiler, kültür sonuçları, ilaç etkileşim sorgusu, antibiyotik tedavi günü, doz önerisi. Homunculus tanı koymaz, order vermez.» Also out: any write from this page, notifications, a rail badge, printing, the last complete day's balance (O4). | One slice; hard rule 5. |
| D20 | **i18n** `src/live/i18n/strings/eczane.js`, four languages; nav label tr «Eczane», az «Aptek», ru «Аптека», en «Pharmacy». Reused as they are: the drug names and the two pressor sentences (`patient.medsDrug*`, `patient.medsRunning`, `patient.medsStopped`), `ageText` (`patient.vitalAge`, `board.ageS/M/H`), `nameOf` (`board.identityPending`), `ScopeNote`'s strings. The Meds box's four antibiotic sentences are whole sentences that begin «Antibiyotik…» and do not fit a cell under an «Antibiyotik» heading; the cells get short keys of their own in the same vocabulary. | Shell rule; one vocabulary. |
| D21 | **Migration `0019_pharmacy_view.py`**: `revision = "0019"`, `down_revision = "0018"`. Only `group_permissions` rows — `pharmacy.view` for the four non-system default groups of every tenant, by slug, `ON CONFLICT DO NOTHING` (0017's statement); `hospital_admin` needs no row (0016's and 0017's precedent). Downgrade deletes the key's rows. No table, no column. **Order:** the care-team slice's `0018_care_team_transfer` reached main first (2026-11-11), so this file follows it; `alembic heads` stays one head (`test_migration_chain_has_a_single_head`). | Alembic is a single chain; `ensure_default_groups` creates missing groups only. |
| D22 | **nginx**: `pharmacy` joins the API prefix list of `deploy/local/web/nginx.conf` (without it the page receives `index.html`). The redacted access log needs **no** map entry: the path has no parameter and carries no patient key, so `default $uri` logs it as it is. | `test_every_app_route_prefix_is_proxied`; `test_routes_without_a_parameter_are_logged_as_they_are`. |
| D23 | **Deploy**: api + web images and `alembic upgrade head` (0019: permission rows only, no table or column); hub, bridge and nce untouched. On the owner's «onay» only. | No device-side change. |

## 3. API

**`GET /pharmacy`** (`pharmacy.view`; the caller's scoped board). No parameter. Answer (synthetic values):

```json
{"now": "2026-11-11T09:30:00+00:00",
 "antibiotic_window_min": 60, "antibiotic_window_source": "surviving-sepsis-campaign-2026",
 "fluid_day": {"start": "2026-11-11T04:00:00+00:00", "end": "2026-11-12T04:00:00+00:00"},
 "fluid_truncated": false,
 "counts": {"patients": 3, "clock_running": 0, "clock_missed": 1, "on_pressor": 1,
            "recognized": 2, "recognized_no_record": 1},
 "rows": [
  {"patient_id": "S-003", "bed_label": "YBU 1-3", "bed_id": "b3", "unit_id": "u1", "display_name": "Örnek Hasta Üç",
   "measured": true, "on_pressor": false, "pressors": [],
   "antibiotic": {"state": "missed", "given": null, "given_at": null,
                  "recognized_at": "2026-11-11T08:05:00+00:00", "deadline": "2026-11-11T09:05:00+00:00",
                  "remaining_sec": -1500},
   "creatinine": {"value": 2.1, "at": "2026-11-11T05:40:00+00:00"},
   "fluid": {"in_ml": 1250.0, "out_ml": 900.0, "balance_ml": 350.0, "entries": 7,
             "last_at": "2026-11-11T09:00:00+00:00"}},
  {"patient_id": "S-001", "bed_label": "YBU 1-1", "bed_id": "b1", "unit_id": "u1", "display_name": "Örnek Hasta Bir",
   "measured": true, "on_pressor": true,
   "pressors": [{"drug": "norepinephrine", "rate": 0.12, "at": "2026-11-11T09:10:00+00:00"},
                {"drug": "dopamine", "rate": 0.0, "at": "2026-11-11T07:00:00+00:00"}],
   "antibiotic": {"state": "met", "given": true, "given_at": "2026-11-11T06:40:00+00:00",
                  "recognized_at": "2026-11-11T06:00:00+00:00", "deadline": "2026-11-11T07:00:00+00:00",
                  "remaining_sec": null},
   "creatinine": null, "fluid": null},
  {"patient_id": "S-002", "bed_label": "YBU 1-2", "bed_id": "b2", "unit_id": "u1", "display_name": "",
   "measured": false, "on_pressor": false, "pressors": [],
   "antibiotic": {"state": "none", "given": null, "given_at": null, "recognized_at": null, "deadline": null,
                  "remaining_sec": null},
   "creatinine": null, "fluid": null}],
 "scope": {"unrestricted": false, "reason": "assigned", "unit_ids": ["u1"], "bed_ids": [], "own_patients": 0,
           "hidden": 4, "unresolved_hidden": 0, "unmatched_unit_ids": [], "unmatched_bed_ids": [], "blind": false},
 "scope_note": null}
```

`now` is the route's instant, taken right after the scoped board was built: `_board_for` judges the cards (and so
`remaining_sec`) at its own instant a moment earlier in the same request and does not hand it back; the fluid day is
computed at `now`. `measured` is false for an identity-only card (an
admitted patient the engine has never measured: no `meds` block) — its row is all «Kayıt yok». `pressors` lists a drug
only when a rate was ever charted, in `_PRESSORS`' order (norepinephrine, epinephrine, dopamine, dobutamine).
`scope` and `scope_note` are exactly `/patients`' (`ScopeResult.as_dict()`, `scope_report`). Refusals: 401 no or
unknown credential; 403 `permission required: pharmacy.view`; 503 «kapsam şu anda okunamıyor».

### 3.1 The antibiotic state, in `_meds`' fields

With `C = meds.antibiotic_clock`, `A = meds.antibiotic_at`, `G = meds.antibiotic_given` (a card without `meds`: all
three null):

| `C` | `A` | further test | `state` | TR text |
|---|---|---|---|---|
| object | null | `C.remaining_sec > 0` | `running` | «Süre işliyor · {süre} kaldı» · second line «tanınma {saat} · uygulama kaydı yok» |
| object | null | `C.remaining_sec <= 0` | `missed` | «Süre aştı · {süre}» · the same second line |
| object | set | `C.met` is true | `met` | «Karşılandı · {saat}» |
| object | set | `C.met` is false | `late` | «Geç verildi · {saat}» |
| null | set | — | `given` | «Verildi · {saat}» |
| null | null | — (`G` null or false) | `none` | «Kayıt yok» |

- `remaining_sec > 0` is the rule's own boundary (`antibiotic_clock.evaluate`: `remaining.total_seconds() > 0` is
  `antibiotic_due`, otherwise `antibiotic_overdue`), so the page and the alarm change word at the same second.
- `A` is the first administration (value ≥ 1) stamped at or after recognition when there is a clock, else the first
  one charted (`_meds`). `met` is `A <= deadline`, the engine's comparison. `{saat}` is `A` as `dayStamp` writes it.
- `G` false with a clock is `running` or `missed` like `G` null: a 0 was charted, or a dose is stamped before
  recognition, which the rule does not count (`_antibiotic_given_since`; open item O2). `G` false without a clock is
  `none`. `given` passes `G` through unchanged, so a later reader can still tell the two.
- The answer's `antibiotic` object is `{state, given, given_at, recognized_at, deadline, remaining_sec}`;
  `remaining_sec` is a number only for `running` and `missed`.

### 3.2 Order and counters

Sort key of a row: `(group, remaining_sec if group == 0 else 0, unit_id == "", unit_id, natural(bed_label or
patient_id), patient_id)` with `group` 0 for `running` / `missed`, 1 for `on_pressor`, 2 otherwise, and `natural`
splitting the label into digit runs (compared as integers) and the rest (case-folded). `counts`: `patients` =
`len(rows)`; `clock_running` and `clock_missed` by state; `on_pressor` rows with `on_pressor`; `recognized` rows with
`recognized_at`; `recognized_no_record` = `clock_running + clock_missed`.

### 3.3 Fluid totals

`fluid_day` is `fluids.fluid_day(now, zone, start_a, start_b)["day"]` with `settings = tasks.settings(hospital) or
DEFAULT_TASK_SETTINGS` and `zone_of(tasks.timezone(hospital))`, as `GET /patients/{id}/fluids` reads them. The entries
are read up to `now + BEDSIDE_SKEW` and summed over `[day.start, day.end)` with `fluids.totals`, so a row's balance
equals «today» in that patient's Sıvı box. `fluid` is null when the patient has no non-withdrawn entry in the day;
else `{in_ml, out_ml, balance_ml, entries, last_at}` (`entries` the count, `last_at` the newest entry's measurement
time). `fluid_truncated` is true when the one read had to cut (its limit, 20 000 rows, as the task board's hand-entry
read); a cut loses the day's oldest rows, and the page then says «Sıvı toplamları eksik olabilir: günün kayıtları
okuma sınırını aştı.»

## 4. Engine and API changes (by file)

- `homunculus-engine/src/homunculus/auth/permissions.py` — `"pharmacy.view": "Open the Eczane page: per patient in
  one's own units — vasopressors, the antibiotic clock, creatinine and the day's fluid balance; read-only"`; the key
  joins `_ATTENDING` (so `attending` and `unit_physician`), the `physician` tuple and the `pharmacist` tuple.
- `homunculus-engine/alembic/versions/0019_pharmacy_view.py` (new) — D21. One statement per `op.execute`.
- `homunculus-engine/src/homunculus/api/board.py` — `_meds` gains `"creatinine_at"`: the latest creatinine
  observation's timestamp, ISO-8601, or None (D12). Additive; the card's other keys are unchanged.
- `homunculus-engine/src/homunculus/api/fluids.py` — `read_entries_by_patient(audit, hospital, *, since, until) ->
  tuple[dict[str, list[FluidEntry]], bool]`: `read_entries` for every patient of the tenant in one read
  (`WARD_READ_LIMIT = 20000`, one row more asked to prove a cut), a withdrawal matched to an entry of the same patient
  (as `tasks._stamps_by_patient`). `read_entries` and it share the row → entry step. `fluid_day` and `totals` are
  reused as they are.
- `homunculus-engine/src/homunculus/api/pharmacy.py` (new) — pure functions, no route: `antibiotic_of(meds) -> dict`
  (§3.1), `pressors_of(meds) -> list[dict]`, `fluid_of(entries, day) -> dict | None`, `row_of(card, fluid) -> dict`,
  `sort_key(row)`, `counts_of(rows) -> dict`, and `ward_pharmacy(cards, audit, *, hospital, now, zone, start_a,
  start_b) -> dict` (the answer without the scope block). It reads the cards' `identity` and `meds` only; it holds no
  reference to the engine.
- `homunculus-engine/src/homunculus/api/app.py` — `PHARMACY_VIEW` beside `BOARD_VIEW`; `GET /pharmacy` after
  `/patients`: `_board_for(authorization, PHARMACY_VIEW)`, the task settings and zone as the fluids route,
  `ward_pharmacy(result.boards, …)`, plus `scope` and `scope_note`. Not audited (D15).
- `deploy/local/web/nginx.conf` — `|pharmacy` in the API prefix location (D22).
- `rules/`, `pipeline.py`, `api/clinical.py`, the hub, the bridge: unchanged.

## 5. Dashboard

- `dashboard/src/backendApi.js` — `pharmacy()` → `authed("/pharmacy")`; the fake API's line in
  `src/live/session/testTokens.testutil.js`.
- `dashboard/src/live/shell/routes.js` — the `lazyScreen` line, the `SCREENS` line and the `ROUTES` entry of D16
  (three lines, blank-line separated).
- `dashboard/src/live/screens/eczane/usePharmacy.js` — read on mount and every `PHARMACY_TICK_MS = 30_000`, the
  sequence guard of `useTasks`; a failed read keeps the last answer and reports the error; an answer without a `rows`
  array is a failed read.
- `dashboard/src/live/screens/eczane/pharmacyModel.js` — pure: `isFresh(answer, error, nowMs)` (§6),
  `durationParts(seconds)` (§5.1), `antibioticCell(row, nowMs, fresh)` → the text key, its parameters and the tone
  (D14), `pressorLines(row, nowMs, fresh)`, `fluidCell(row)`. It reads the server's `state`, `counts` and row order
  and never recomputes them.
- `dashboard/src/live/screens/eczane/EczaneScreen.jsx` — D16's page. It does not read the board store for its rows
  and draws no `BoardStrip` (the board's stream is not its source); it draws `ScopeNote` from the answer's `scope` /
  `scope_note`, and reads the clock with `useBoardNow(10_000)`.
- `dashboard/src/live/i18n/strings/eczane.js` and the catalog's import and entry lines (D20).
- `dashboard/src/live/screens/admin/catalogue.js` (`PERMISSION_KEYS`), `admin.testutil.js` (`PERMISSION_TEXTS`, the
  backend's sentence) and `src/live/i18n/strings/perms.js` (`pharmacy: { view }` in four languages; tr: «“Eczane”
  sayfasını açar: kendi birimlerindeki hastaların vazopresörlerini, antibiyotik süresini, kreatininini ve günün sıvı
  dengesini salt okunur görür»). In all four mirrors (`PERMISSIONS`, `catalogue.js`, `admin.testutil.js`, `perms.js`) the
  key follows `summary.view`, in the same order.

### 5.1 Durations

`running` prints the time to `deadline`, `missed` the time since it, both from the server's `deadline` against the
screen's clock. `n = floor(seconds / 60)`, as the engine's alarm text counts (`int(seconds // 60)`): 0 is «<1 dk»,
under 120 «{n} dk», from 120 on «{h} sa {m} dk». The state word does not follow the screen's clock: a `running` row
whose deadline passes between two polls reads «Süre işliyor · <1 dk kaldı» until the next answer says `missed`.

## 6. Stale and failed reads

- **Fresh** = the last read succeeded and the answer's `now` is at most `PHARMACY_FRESH_MS = 90_000` behind the
  screen's clock (three polls; a hidden tab shown again is not fresh until its poll lands).
- **Not fresh, an answer held**: a `crit` Alert leads the page — «Eczane listesi güncel değil · son yanıt {saat}», with
  the read's reason when it failed (`readErrorText`). The counters keep their numbers under «son yanıt {saat}
  itibarıyla». `running` and `missed` cells stop counting and read in the past tense with the one stamp that stays
  true: «Son yanıtta süre işliyordu · bitiş {saat}», «Son yanıtta süre aşılmıştı · bitiş {saat}». Vasopressor ages
  become the charted time (`dayStamp`). The other cells are records with their own times and stand as they are.
- **No answer yet and the read failed**: «Eczane listesi okunamadı: {neden}»; no counter, no table — never zeros.
- **No answer yet, read in flight**: a loading note.
- **Empty `rows`**: only a fresh answer may say «Görünümünüzde yatan hasta yok.», under the `ScopeNote` (a blind scope
  is explained by the engine's own sentence). A list that is not fresh with no rows says only that it is not fresh.
- A counter of 0 is a number the server sent, not a reassurance: D8's note stays on the page in every state.
- 403 (the right was withdrawn mid-session) and 503 (scope unreadable) are failed reads, worded by `apiErrors.js` as
  everywhere.

## 7. Testing

- Engine, DB-less:
  - `tests/test_pharmacy.py` — `antibiotic_of` for the six states, `G` false with and without a clock, a card without
    `meds`, the boundary (`remaining_sec` 1 is `running`, 0 and −1 are `missed`); `pressors_of` (a 0 rate listed as
    stopped, a never-charted drug absent); `fluid_of` (null without entries, withdrawn entries excluded, `last_at`);
    `sort_key` (most overdue first, then least time left, then the vasopressor group, then unit and natural bed order —
    «YBU 1-2» before «YBU 1-10», a row on no unit last); `counts_of` (`recognized_no_record` = running + missed).
  - `tests/test_pharmacy_api.py` — the route: 403 without the key and 200 with it alone; only the caller's beds, with
    `scope` and `scope_note`; 503 for an unreadable scope; an identity-only card's row; the fluid day from the task
    settings and the tenant's zone (`Asia/Baku`), an entry before the day start left out; creatinine with its time; the
    read appends nothing to the audit log; a patient discharged through Kabul is absent, as on `/patients`; the device
    token passes.
  - `tests/test_fluids.py` — `read_entries_by_patient` agrees with `read_entries` patient by patient; a withdrawal
    never crosses patients; `truncated`.
  - `tests/test_api_board_meds.py` — `creatinine_at`.
  - `tests/test_board_permissions.py` — `("GET", "/pharmacy"): "pharmacy.view"` in `BOARD_EXPECTED` (its two
    parametrized tests then cover the 403 and the open case).
  - `tests/test_permissions.py` — 28 keys (G4-02's `summary.view` made 27); `SPEC_GROUPS` for `attending`, `unit_physician`, `physician`, `pharmacist`.
  - `tests/test_nginx_routes.py` — `/pharmacy` in `API_PATHS`; `tests/test_access_log_redaction.py` passes unchanged.
- Engine, Postgres part: `tests/test_migration_0019_pharmacy_view.py`, in the shape of `test_tasks_postgres.py`'s three
  migration tests — upgrade to `0018`, a tenant with `pharmacist`, `physician` and `nurse` groups, upgrade to `0019`:
  the two get the row, the nurse none; the statement is idempotent; downgrade to `0018` removes the rows and leaves
  the groups and their other rows.
- Dashboard: `pharmacyModel.test.js` (durations at 0, 59 s, 119 min, 120 min; each state's key and tone; the stale
  twins; no tone on creatinine or fluid), `EczaneScreen.test.jsx` (the counters and the rows in the server's order;
  the six states; «Kayıt yok» never «verilmedi»; the link only with `board.view`; the notes of D8, D9 and D19 present;
  fresh, not fresh, failed first read, empty), `shell/routes.test.js` (the route, its place between `devir` and `ozet`, the
  nurse and the auditor cannot reach it, `pharmacy.view` alone lands on `/eczane`; the pinned route tails updated),
  `admin/catalogue.test.js` and `admin.testutil.test.js` (the mirrors), `i18n/strings.test.js` (four languages, same
  keys and placeholders), `rawKeys.test.jsx` (sweeps the new screen).
- Gates as G3-03: the engine's no-DB suite, the Postgres part on a disposable database, the Python 3.14 slice, the
  dashboard suite, `npm run build` (one more lazy chunk; the precache count is recorded).

## 8. Deploy

As its own release, after the owner's «main'e al» and «onay»: bundle → `alembic upgrade head` (0019) → api + web
images (the web image carries `nginx.conf`). If G2-B1c's `0018` is not on the server yet, the same
`upgrade head` runs it first, and that release then also carries B1c's deploy notes. Rollback: `alembic downgrade` to the previous revision from this
release's image, then the previous image tags. Rights travel in the token: a session opened before the deploy shows
the page once its token is renewed. Blocks one at a time; the owner walks the page with a pharmacist account.

## 9. Open items

- O1 The fourth counter. As approved («no antibiotic record among sepsis-recognised patients») it always equals
  running + missed; this spec shows «Sepsis tanınan» with that number as its second line (D11). Owner confirmed, 2026-11-11.
- O2 A dose charted before recognition does not stop the clock (the engine's rule), so that patient reads «Süre
  işliyor» / «Süre aştı» here as in the alarm. Whether an earlier dose should count is a question about time zero,
  which [[antimicrobial-timing-sepsis]] leaves open ([[open-questions]]); no change without a source. Owner: no change, 2026-11-11.
- O3 A clock nobody answers stays «Süre aştı» until infection is charted absent or the patient is discharged, and
  sorts first. Kept (owner, 2026-11-11); to be looked at after the pilot's first week (e.g. marking rows whose sepsis alarm no
  longer fires).
- O4 The last complete day's balance beside today's (right after the day turns the column is empty).
- O5 A renal-dosing threshold for creatinine, a fluid-balance target, and how old a vasopressor rate may be before it
  is doubted: each needs a source in the vault first.
- O6 A device token reads `/pharmacy` with names, as it reads `/patients` (Görevlerim's O10) — the owner's call for
  the list reads together.
- O7 AZ, RU and EN texts await a native reading, as every namespace.
- O8 The Meds box could print `creatinine_at`, now on the card; not in this slice.

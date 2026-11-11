# G3-03 · Fluid balance («Sıvı dengesi») — design

Group 3, slice 3 (roadmap `2026-10-01-tasarim-entegrasyonu-yol-haritasi.md`, Grup 3: «sıvı»). Lane A. Owner's
decisions of 2026-11-09: scope **A** (the nurse's whole intake/output ledger, totals, balance, the 24-hour urine
beside the SOFA renal row), fluid day **08:00 → 08:00** read from Görevlerim's shift setting, architecture **1**
(every entry is a chart observation; the server adds up), «yaz». Builds on G3-01 (bedside door, «hatalı giriş»,
the `manual` read of trends), G2-A3 (meds chart: crystalloid bolus, weight), G3-02 (task settings: shift start,
tenant zone) and the patient screen of the Group 1 shell. Branch `feat/g3-sivi`, cut from `feat/g3-gorevlerim`.

## 1. Why

The ward keeps a fluid chart on paper: what went in (IV fluids, boluses, enteral feed, blood products), what came
out (urine, drains, NG/vomit), the shift and day totals and the running balance. The engine already accepts two of
these values — a crystalloid bolus (G2-A3, it feeds the septic-shock rule's 3-hour sum) and urine output (accepted
at the door, used by nothing) — but no screen keeps the ledger, so the totals live on paper and the engine sees a
fraction of the picture.

This slice keeps the ledger in Homunculus: one entry per volume, every entry audited and withdrawable, every sum
done by the server. It adds no clinical rule. The only sourced number shown beside the totals is the SOFA renal
row of Sepsis-3 (24-hour urine <500 mL/day → 3 points, <200 mL/day → 4 points, [[sepsis-3-jama-2016]], an
`extract`): it is written next to the last complete day's urine total as a reference, and the system awards no
points — an incomplete chart understates the total, so the screen says how many of the 24 hours carry an entry.

## 2. Decisions

| # | Decision | Why |
|---|---|---|
| D1 | **Every entry is a chart observation** through `POST /clinical/{id}` (G3-01's door): a code, a volume in mL, a time. It is a `chart` row in the audit chain and an observation in the engine's timeline. No new table, no migration. | One door, one trail, one withdrawal path; the engine sees the volumes. |
| D2 | **Codes.** Intake: `iv_fluid_ml` (IV fluid / infusion volume, NEW), `crystalloid_bolus_ml` (existing), `enteral_ml` (enteral / oral, NEW), `blood_product_ml` (NEW), `other_intake_ml` (NEW). Output: `urine_output_ml` (existing, «since the last entry»), `drain_output_ml` (NEW), `other_output_ml` (NG, vomit, stool estimate — NEW). Each in mL, bounds 0–5000 per entry (the bolus keeps G2-A3's 0–10000). The five new codes enter no rule; the bolus keeps feeding `rules/septic_shock.py`. | The prototype's categories (patient.js «Sıvı»), reduced to what a nurse charts by hand. |
| D3 | **Time.** `recorded_at` at most 24 h back and not ahead (BEDSIDE_SKEW), as the bedside set: `_check_bedside`'s time bound covers the fluid codes too. An untouched time is the server's clock. | Same rule as G3-01 D7; a volume is a measurement. |
| D4 | **Withdrawal.** The eight fluid codes join `RETRACTABLE_CODES`: «hatalı giriş» with a reason (10–200 chars) withdraws a wrong volume and the patient is rebuilt (G3-01 D12). This includes the bolus — **a departure from G3-01 X22** (meds chart corrected by a new entry): a volume cannot be corrected by a new entry, and withdrawing a bolus correctly re-runs the septic-shock rule on the rebuilt state. | A ledger without corrections is not usable. |
| D5 | **The fluid day** starts at Görevlerim's first shift start (`task_settings.shift_start_a`, default 08:00) in the tenant's zone and runs 24 h; the two shift subtotals are [start_a, start_b) and [start_b, next start_a). Read through the task store (`TaskStore.settings`, `TaskStore.timezone`); defaults when no row. | One setting for the ward's day; owner chose 08→08. |
| D6 | **The read** `GET /patients/{id}/fluids` (`board.view`, the patient must be on the caller's board — 404 otherwise, as `/patients/{id}/trends`). The server sums; the browser does no clinical arithmetic (G2-A3 Decision 1). | The engine is the one that adds. |
| D7 | **What it answers** (§3): the current day window and the last complete day window; per hour of the current day the intake and output by code; totals per window (today so far, shift A, shift B, last complete day) by code with `in`, `out`, `balance`; the cumulative balance per hour; the entries of the current and last day (entry id, code, value, time, by, withdrawn); `urine_last_day_ml` and `hours_with_urine_last_day` (how many of its 24 hours carry a urine entry); `weight_kg` (the last charted weight, G2-A3) and `urine_ml_kg_h_last_6h` (a number, None without weight or without urine entries in 6 h). | What the box shows, already computed. |
| D8 | **SOFA renal reference.** The box writes the last complete day's urine total and, beside it, the Sepsis-3 bands as text: «Sepsis-3 SOFA böbrek satırı: <500 mL/gün 3 puan, <200 mL/gün 4 puan». No points are computed or shown, nothing is coloured, the SOFA form (G2-A4) is not fed (open item O2). `hours_with_urine_last_day` is shown with it («24 saatin N'inde idrar kaydı var»). | Hard rules 1 and 5: the source is real, the inference is the clinician's. |
| D9 | **mL/kg/h** is shown as a number with its window («son 6 saat»), never coloured, no threshold — the vault has no source for an oliguria threshold (open item O3). | No clinical claim without a source. |
| D10 | **Screen.** Patient screen: a **«Sıvı» box** under the Meds box. Big numbers: today's intake, output, balance (signed). Shift subtotals; the last complete day's intake / output / balance and urine total with D8's text. An hourly bar chart (intake up, output down) with a cumulative-balance line, the day's 24 columns from the day start. «Giriş/çıkış ekle» (`clinical.chart` only; absent otherwise): a dialog with one or more rows — category (eight), mL, time (default now) — saved in ONE `/clinical` request (all or nothing). A list of the current day's entries (time, category, mL, by) with «hatalı giriş» (G3-01's withdrawal dialog). | The prototype's tab, as a box on today's patient screen. |
| D11 | **The bolus in two places.** The Meds box form keeps its bolus field (G2-A3, live). Both write the same code; the Sıvı list shows every bolus whichever form wrote it. The Sıvı dialog labels the bolus row «Kristaloid bolus (İlaçlar kutusundakiyle aynı kayıt)». | No change to a live form; no double counting (one code, one sum). |
| D12 | **Refresh.** The box reads on mount, every 60 s, and after any write or withdrawal on this patient (the board store's `chart`/`retract` resolve). | Ward tempo. |
| D13 | **i18n** `src/live/i18n/strings/sivi.js`, four languages; category names in the catalog; numbers formatted with the existing helpers. | Shell rule. |
| D14 | **Out of this slice:** pump integration; an hourly urine reminder in Görevlerim (O1); feeding the SOFA form's renal row (O2); an oliguria threshold (O3); a fluid tab in the patient list or the board card; editing a volume (withdraw + new entry instead). | One slice. |
| D15 | **Deploy** after G3-02 (it reads `task_settings`); api + web only; no migration; hub, bridge, nce, postgres untouched. | The order the code depends on. |

## 3. API

**`POST /clinical/{id}`** — unchanged body; the new codes are accepted:
`{"recorded_at": "…", "entries": [{"code": "urine_output_ml", "value": 120}, {"code": "iv_fluid_ml", "value": 250}]}`.
Refusals as today (unknown code, out of bounds, time window, discharged → `dropped`).

**`GET /patients/{id}/fluids`** (`board.view`, on the caller's board):

```json
{"patient_id": "S-001", "now": "…",
 "day": {"start": "…", "end": "…"}, "last_day": {"start": "…", "end": "…"},
 "shifts": [{"start": "…", "end": "…"}, {"start": "…", "end": "…"}],
 "codes": {"intake": ["iv_fluid_ml", "crystalloid_bolus_ml", "enteral_ml", "blood_product_ml", "other_intake_ml"],
           "output": ["urine_output_ml", "drain_output_ml", "other_output_ml"]},
 "hours": [{"start": "…", "in": {"iv_fluid_ml": 250}, "out": {"urine_output_ml": 120}, "balance_cum": 130}],
 "totals": {"today": {"in": 1250, "out": 900, "balance": 350, "by_code": {"iv_fluid_ml": 1000, "urine_output_ml": 800}},
            "shift_a": {"…": "…"}, "shift_b": {"…": "…"}, "last_day": {"…": "…"}},
 "urine_last_day_ml": 1480, "hours_with_urine_last_day": 18,
 "weight_kg": 72.0, "urine_ml_kg_h_last_6h": 0.9,
 "sofa_renal_reference": {"source": "sepsis-3-jama-2016", "bands": [{"below_ml_day": 500, "points": 3}, {"below_ml_day": 200, "points": 4}]},
 "entries": [{"entry": 123, "code": "urine_output_ml", "value": 120, "at": "…", "by": "hem.ayse", "retracted": null}]}
```

A shift window not yet started is all zeros; a code never charted is absent from `by_code`. Withdrawn entries are
listed with `retracted` and are in no sum. `sofa_renal_reference` is static text from the vault, not a computation.

**`POST /clinical/{id}/entries/{entry}/retract`** — unchanged; the eight fluid codes are now withdrawable (D4).

## 4. Engine and API changes (by file)

- `canonical.py` — five new `SignalCode`s (D2).
- `api/clinical.py` — `CHARTABLE` units and bounds for the five; `FLUID_CODES` (the eight); `_check_bedside`'s time
  bound applies to `BEDSIDE_VITALS | FLUID_CODES`; `RETRACTABLE_CODES |= FLUID_CODES`.
- `api/fluids.py` (new) — pure functions: `fluid_day(now, zone, start_a, start_b)`, `sum_windows(entries, …)`,
  `hourly(entries, day)`, `urine_rate(entries, weight, now)`; the read `patient_fluids(audit, store, hospital,
  patient_id, now, settings, zone)` that takes the `chart`/`chart_retract` rows of the last 48 h (as `trends._manual`)
  and the last `weight_kg`.
- `api/app.py` — `GET /patients/{patient_id}/fluids` beside `/trends`, with `_require_patient` (scope, 404).
- No migration. `rules/` unchanged.

## 5. Dashboard

- `src/backendApi.js` — `patientFluids(id)`; `fakeApi` line.
- `src/live/screens/patient/fluids/FluidsBox.jsx` (the box), `FluidChart.jsx` (bars + line, SVG, no library),
  `FluidEntryDialog.jsx` (rows: category, mL, time; one request), `fluidCodes.js` (the eight codes, their
  categories and bounds as the server's), `useFluids.js` (read on mount, 60 s, after writes), tests beside each.
- `PatientScreen.jsx` — the box under the Meds box (one line, blank-line separated).
- The withdrawal reuses G3-01's dialog (`SavedStep`/retract flow) for a fluid entry.
- `src/live/i18n/strings/sivi.js` and the catalog line; `apiErrors.js` needs no new words (the door's refusals are
  G3-01's).

## 6. Testing

- Engine: `tests/test_fluids.py` (day window across midnight and at the boundary in `Asia/Baku`, shift subtotals,
  hourly buckets, cumulative balance, withdrawn entries excluded, last-day urine and hours covered, mL/kg/h with and
  without weight, codes absent when never charted), `tests/test_fluids_api.py` (rights, 404 off-board, the new codes
  at the door incl. bounds and the 24-h time rule, withdrawal of a fluid entry and of a bolus re-running the
  septic-shock rule, a discharged patient).
- Dashboard: `FluidsBox.test.jsx` (numbers, shift subtotals, the SOFA reference text with hours covered, no colour on
  mL/kg/h, absent «ekle» without `clinical.chart`, the dialog's one-request save and refusals, «hatalı giriş»),
  `fluidCodes.test.js`, four-language dictionaries.
- Gates as G3-02: engine no-DB suite, Python 3.14 slice, dashboard suite, build.

## 7. Deploy

After G3-02 is live: api + web images; no migration; rollback = previous image tags. Blocks one at a time, owner's
«onay» first.

## 8. Open items

- O1 An hourly urine reminder as a Görevlerim source (needs the hospital's protocol; no vault source).
- O2 Feeding the SOFA form's renal row from the last complete day (needs a decision on incomplete charts).
- O3 An oliguria threshold for mL/kg/h — ingest a source (e.g. KDIGO) into the vault first.
- O4 Pump integration (devices not connected).
- O5 AZ, RU and EN texts await a native reading, as every namespace.

## 9. Amendments (implementation and review, 2026-11-10)

- **Build note.** With B3a, B4/B6, B5, G3-02 and this slice together, the `LiveApp` chunk is 502.8 kB — 2.8 kB over
  Rollup's 500 kB warning (a warning, the build passes; precache 20). A static `manualChunks` split was tried and
  not kept (shared modules make chunk cycles possible, and no browser smoke could be run); the fix is a separate
  slice: route-level lazy loading of the screens with a browser check (open item O6).

- **A1 (D3)** The 24-hour time rule binds every fluid code at the server, so the meds form's bolus too (the
  browser already limited it); seven older tests that charted a bolus months back now chart it three hours back.
- **A2 (§3)** The door refuses with **400** (as G3-01's bedside door), not 422.
- **A3 (D4)** `RETRACT_NOT_BEDSIDE` now reads «yalnız yatak başı ölçümü ve sıvı girişi hatalı giriş olarak
  işaretlenebilir»; the dashboard's mapping and its four-language text follow.
- **A4 (D7)** `api/fluids.py` reuses `trends._instant` / `_finite_number` (a zoneless time or a non-finite value
  is left out, as trends does); the day windows are computed in UTC (always 24 rows); each hour also carries
  `in_ml` / `out_ml` so the chart draws the engine's sums.
- **A5 (D10)** A failed read is a warning Note (the SOFA box's pattern), not an Alert; toasts name the bed; two
  TR texts avoid suffixes on placeholders; volumes are shown with one decimal.
- **A6 (§3)** `balance_cum` is null for an hour not yet begun (the line stops at now); a top-level `truncated` says the 48-h read was cut (the box says so); sums are rounded to 3 places, never −0.
- **A7 (§3, D7)** «today» is the day window over entries read up to now + BEDSIDE_SKEW, so today = shift A + shift B = the sum of the hours.
- **A8 (D10)** Rows with different times go as one request per time: a partial save is possible; the toast says how many were saved, refused and unsent rows stay in the dialog.
- **A9 (D12)** The Meds box's saves (bolus, weight) also re-read the Sıvı box (the screen's `reread`, as the SOFA box).
- **A10 (D8)** The reference text adds «Sistem puan vermez; eksik kayıt toplamı düşük gösterir.»
- **Known limits** the fluid day is a fixed 24 h (no DST in Asia/Baku); a discharge arriving mid multi-request save does not name the rows already saved.

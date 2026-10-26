# G2-A3 · Vazopresör/sıvı kaydı: the septic-shock inputs charted from the patient screen — design

**Date:** 2026-10-26 · **Lane:** A (patient & engine) · **Branch:** `feat/g2a-a3`, created off `main` at `411d89c`
(NBP + A1 + A2 + A-11). **Owner decisions (2026-10-26, three questions):** Q1 = 1 (the septic-shock input set),
Q2 = 1 ("current rate" semantics, 0 = stopped, a short history), Q3 = 1 (back-dating up to 24 h, a correction is a new
entry, a wrong bolus cannot be undone in this slice). Code references were read at `411d89c`.

## 1. The problem

The engine already evaluates septic shock and SOFA's cardiovascular limb from four vasopressor/inotrope rates
(norepinephrine, epinephrine, dopamine, dobutamine — µg/kg/min), the crystalloid given (mL, 30 mL/kg within 3 h,
`rules/septic_shock.py:17–41`), the weight and the antibiotic administration, and the `/clinical/{id}` door accepts all
of them (`api/clinical.py` `CHARTABLE`, `PLAUSIBLE`, `build_entries`, `recorded_at`). The dashboard charts none of them:
the patient screen's `Sepsis` box charts only `suspected_infection`, `BaselineForm` writes the profile, and the `Meds`
box is read-only (`PatientScreen.jsx:234–262`). The prototype's charting module was dropped at G1-15 (14.10 decision,
roadmap: "Grup 2 geri getirir"), and the ward announcement says the septic-shock rule gets no vasopressor information.
So today a patient on 0.3 µg/kg/min of norepinephrine with a lactate of 4 is not in septic shock for Homunculus.

## 2. Decisions

| # | Decision | Why |
|---|---|---|
| D1 | **Scope (Q1):** the four pressor/inotrope rates, the crystalloid bolus, the weight and "antibiotic given" — charted through the existing `POST /clinical/{id}` door, one request per save, no new engine rule and no new audit event. | Exactly the inputs the septic-shock rule and the antibiotic clock read; the door, its units, bounds and audit (`chart` rows with `charted_by`) already exist. Labs and urine output go with A4 (the SOFA form). |
| D2 | **Semantics (Q2):** a pressor entry is the infusion's *current* rate in µg/kg/min at `recorded_at`; a change is a new entry; **0 means stopped**. A bolus entry is one bolus (mL); the rule sums the 3-hour window itself. Weight is the latest value. Antibiotic given = `antibiotic_administered 1` at the charted time (the form never writes 0: "not given" stays "nobody charted it", three-valued as `_meds` publishes it). | The engine reads `state.latest()` for rates and `sum_since` for fluids (`septic_shock.py:41`); no start/stop model is needed for the rule. A start/stop/cumulative-dose model is Group 3's medication workflow. |
| D3 | **Time and correction (Q3):** the form has one "kayıt saati" (`datetime-local`), default now, **at most 24 h back, never in the future**; the door is unchanged (it accepts any past stamp for backfill and judges a future one no later than the wall clock, A2 X10). A wrong rate or weight is corrected by a new entry with the right value — the audit is append-only and the card shows the latest. **A wrong bolus cannot be undone** in this slice: the rule's 3-hour sum may run high until the window passes; the form says so under the bolus field. | A nurse charts at the end of a round, not at the pump. An "iptal" event that the engine and the replay honour is a separate mini-slice (O1). |
| D4 | **Placement:** the `Meds` box on the patient screen gets a **«Kayıt ekle»** button for callers with `clinical.chart`; without the permission the button is not rendered (the pattern the own-normal form follows). The form opens inside the box: pressor (select of four) + rate, bolus mL, weight kg, antibiotic given (checkbox), the time, Save / Cancel. Every field optional, at least one filled. Save → `board.store.chart(id, entries, recordedAt)` → toast «patient.chartSaved»; a refusal goes to the toast with the server's own sentence, nothing is written locally; `busy` while in flight (one save at a time — the store reloads the board). | One place for the medication picture, read and write; the Sepsis box already does this for one entry, and the store's `chart()` already reloads the board (`boardStore.js:335–345`). |
| D5 | **Card payload:** `_meds` (`api/board.py:133`) gains `pressors_at` — `{name: ISO-8601 \| null}` beside the existing numeric `pressors` — and `charted`: the last **10** observations of the six codes across all of them, newest first, `[{code, value, unit, ts}]`, `MEDS_HISTORY = 10`. The box shows each running pressor with its time ("noradrenalin 0.12 µg/kg/dk · 14:05"), "durduruldu" for a 0, the weight, the antibiotic line as today, and the history as a compact list. | The history needs no new endpoint and no `audit.view` permission (the audit route requires it; a nurse may not hold it). Ten entries is a round's worth; the audit keeps everything. The existing keys stay, so every current test and screen is unaffected. |
| D6 | **Validation:** the form mirrors `PLAUSIBLE` for its six codes as input `min`/`max`/`step` (rates 0–20 / 0–100 µg/kg/min, two decimals; bolus 0–10 000 mL, whole; weight 0.3–400 kg, one decimal) and refuses an empty form and a time outside [now − 24 h, now]; **the server stays authoritative** — its 400 sentence is what the toast shows. No screen computes a clinical value (Decision 1): the form converts nothing (no mL/h → µg/kg/min, O2). | The bounds catch slipped decimals before a round trip; the sentence a clinician reads on refusal is the door's, not a second one. |
| D7 | **Languages:** every new string in `live/i18n/strings/patient.js` for az (default), tr, ru, en, with placeholder parity and the az≠tr rule (`strings.test.js`); drug names are the four pharmacological names in each language's usual spelling. | The pilot's rule since G1. |
| D8 | **Accessibility and layout:** labelled inputs, hints bound with `aria-describedby`, the refusal in text as well as the toast, keyboard-only use, phone width (16 px gutter, no horizontal scroll); the history list is a `<ul>`, not a table. | The patient screen's standard (G1-11). |
| D9 | **Not in this slice:** who charted each history entry (the audit row has `charted_by`, the observation does not — O3), unit conversion (O2), an "iptal" event (O1), start/stop infusion model (Group 3), labs/urine output and the SOFA form (A4), any new alert. | YAGNI; each is its own decision. |

## 3. Components

- `homunculus-engine/src/homunculus/api/board.py` — `_meds`: `pressors_at`, `charted` (`MEDS_HISTORY = 10`), read from
  `state.history(code)` for the six codes, merged and sorted by timestamp descending, each as
  `{"code": code.value, "value", "unit": obs.unit, "ts": iso}`.
- `homunculus-engine/tests/test_api_board_meds.py` — the new keys: times, the 0-rate, the order and the cap, the absence
  when nothing is charted, the existing keys unchanged.
- `dashboard/src/live/screens/patient/meds/MedsBox.jsx` — the `Meds` function moved out of `PatientScreen.jsx`, plus the
  running-pressor lines with times and the history list.
- `dashboard/src/live/screens/patient/meds/MedsChartForm.jsx` — the form (D4, D6); `medsFields.js` with the six codes,
  their bounds, steps and label keys (one table, read by the form and its tests).
- `dashboard/src/live/screens/patient/PatientScreen.jsx` — renders `MedsBox` with `canChart`, `onChart` (the existing
  `chart` flow generalised to `entries, recordedAt`) and `busy`.
- `dashboard/src/live/i18n/strings/patient.js` — the new keys (four languages).
- Tests: `MedsBox.test.jsx`, `MedsChartForm.test.jsx` (render per permission, validation, the payload sent, the time
  bounds, busy/refusal), `PatientScreen.test.jsx` (the box in place, the toast on save and on refusal),
  `strings.test.js` (parity).
- Docs: `docs/homunculus-rehber-TR.md` (clinician: how to chart a pressor, what 0 means, back-dating, the bolus
  limitation), `homunculus-engine/README.md` is a stub — nothing there; the roadmap row G2-A3.

## 4. Data flow

Save → `entries = [{code: "norepinephrine_rate", value: 0.12}, {code: "crystalloid_bolus_ml", value: 500}, …]`,
`recorded_at = <ISO-8601 with zone>` → `store.chart(id, entries, recordedAt)` → `POST /clinical/{id}` →
`chart_observations` (A-11 X62): each entry judged at `min(recorded_at, now)`, the hook, the `chart` rows, the
`alert` rows, the stamps → one board frame → the store reloads → the Meds box shows the new rates, the history and —
if the rule now fires — the septic-shock alert on every surface. A refusal (400 with the door's sentence, 403 without
the permission, 404 out of scope, 200 `dropped` for a discharged kabul number — A-11) reaches the toast; the form keeps
its values so the clinician can fix and resend.

## 5. Errors and edge cases

- Weight unknown: rates are µg/kg/min as entered; the 30 mL/kg target cannot be judged without a weight — the rule
  already says so in its reasoning; the form shows the weight field first with a hint "30 mL/kg için gerekli".
- Two pressors at once: each has its own entry and its own latest; the box lists all running ones.
- Rate entered for a pressor that was never running, then 0: both are entries; the box shows "durduruldu · 14:05".
- A reading posted while the form is open: the box re-renders from the board; the form's draft is kept (local state).
- Discharged kabul patient (A-11): the door answers 200 `{"dropped": "discharged"}`; the store treats a 200 without
  `charted` as a refusal with the key `patient.chartDropped` (new string) — nothing was charted.
- Clock skew: the browser's "now" bounds the time field; the door clamps a future stamp (A2 X10), so a few seconds of
  skew never refuse a save.
- No `clinical.chart`: no button; a direct call answers 403 and the toast shows the server's sentence (existing).

## 6. Tests

- Engine (`test_api_board_meds.py`): `pressors_at` carries the latest stamp per pressor and `null` when none; a 0-rate
  is published as 0 with its time; `charted` is newest-first, mixed codes, capped at 10 with the newest kept, with the
  door's units; empty when nothing was charted; `pressors`, `weight_kg`, `antibiotic_*` unchanged.
- Dashboard (`MedsChartForm.test.jsx`): hidden without the permission; empty form refused with text; bounds refuse a
  slipped decimal (25 µg/kg/min) before sending; a valid form sends exactly the entries filled, with `recorded_at`
  in ISO-8601 with zone; the time field refuses a future time and one older than 24 h; busy disables Save; a 400 shows
  the server's sentence and keeps the draft; a 200 `dropped` shows `patient.chartDropped`.
- Dashboard (`MedsBox.test.jsx`): running pressors with time, "durduruldu" for 0, the history list order, the
  antibiotic three-valued line unchanged.
- `strings.test.js`: parity and az≠tr for the new keys. `PatientScreen.test.jsx`: the box mounts and the save toast.
- Build: `vite build` passes; gates: engine no-DB, dashboard vitest.

## 7. Out of scope

A4 (SOFA form: labs, urine output, GCS, FiO2 …), Group 3 medication workflow (orders, start/stop, cumulative dose),
unit conversion, the audit's `charted_by` on the card, any VM deploy (with the next deploy, order decided with B1a).

## 8. Open items

- **O1** An «iptal» (annul) event: a wrong entry the engine and the replay remove from the state; needs an audit event,
  `PatientState` support and `rehydrate`; its own mini-slice.
- **O2** mL/h ↔ µg/kg/min conversion needs the syringe concentration and the weight; a helper beside the rate field,
  if the ward asks for it, must show its arithmetic and never write the converted number itself.
- **O3** `charted_by` on the history entries: either the observation carries provenance beyond `source_device`, or the
  box reads the audit when the caller holds `audit.view`.
- **O4** The roadmap's Group 3 item "Verilen sıvı (yalnız giriş); çıkış gönderilmez": output (urine) stays out here too.

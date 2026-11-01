# G2-A4 · SOFA formu: the severity form filled, completed, previewed and signed from the patient screen — design

**Date:** 2026-11-01 · **Lane:** A (patient & engine) · **Branch:** `feat/g2a-a4-sofa`, off `main` `ec66a57` (NBP-2 +
HR/PLS fix live on the VM). **Owner decisions (2026-10-31/11-01):** the open organ rows are completed from the form
(Q1 = 1, «devam et» on the recommended answer); the ten decisions below were presented and accepted the same way
(«devam et»). Code references were read at `ec66a57`.

## 1. The problem

The backend already holds the whole SOFA severity form. `GET /scores/sofa/{id}` builds it from the record — six organ
rows, each with the WORST value of a 24-hour window, the measurement behind it, its time and its points; an organ with
no measurement is "unmeasured", never zero (`scoring/sofa_form.py`). `POST /scores/sofa/{id}` signs it with the
clinician's corrections: a correction replaces the VALUE, the points are re-scored from the table, the original value is
kept, a reason of at least 20 characters is required, a device cannot sign, and the signature is sealed into the audit
chain (`scoring/signing.py`, `api/app.py:1442–1531`). The API client still has both calls (`backendApi.js`
`severityForm`, `signSeverityForm`).

The live interface has no form: the old screen went with the demo at G1-16, and the patient screen says "formlar
yakında" where it will go (`PatientScreen.jsx:434`). And a form opened today would be almost empty: there is no
laboratory feed, the HL7 feed has been silent since 2026-09-05, and the monitors feed only the shadow engine. Two
inputs cannot be entered at all: whether the patient is on respiratory support (`ON_RESP_SUPPORT`, which decides the 3–4
point bands of PaO₂/FiO₂, `sofa_form.py:131`), and four of the five labs have no plausibility bound at the door.

## 2. Decisions

| # | Decision | Why |
|---|---|---|
| D1 | **Placement:** a **SOFA box** replaces the "formlar yakında" note on the patient screen: the form's total, how many organs are unmeasured, and the last signature — «✓ İmzalandı · {who} · {HH:MM} · toplam {n}» or «imzalanmadı». «Formu aç» opens a modal. | The A3 pattern (box + modal, X1); the patient screen has no tabs, and adding them is not this slice. |
| D2 | **The form:** six organ rows in the source's order (respiration, coagulation, liver, cardiovascular, CNS, renal). Each shows the worst value, its unit, when it was measured, its source and its points; "ölçülmedi" for an unmeasured organ (never a 0); the organ-failure mark at ≥ 3 points; the window («son 24 saat», or the shorter period since admission when `covers_full_window` is false). | The backend's three refusals (no alert, no invention, no self-signing) are kept on screen. |
| D3 | **Completing a row (Q1):** an unmeasured or out-of-date input can be entered in the form — platelets, bilirubin, creatinine, GCS, PaO₂/FiO₂, and "solunum desteğinde" yes/no. The entry is charted through the existing `POST /clinical/{id}` door (`clinical.chart`, no reason: it is a measurement, not a correction), with a measurement time (now by default, at most 24 h back, never ahead — A3's D3), and the form is read again. | A correction reason is for changing what the record holds, not for adding what it lacks; when a lab feed opens these arrive on their own. |
| D4 | **The door gains one code and four bounds:** `ON_RESP_SUPPORT` becomes chartable as a flag (`CHARTABLE` "bool", `_BOOLEAN`); `PLAUSIBLE` gains PLATELETS 0–2000 ×10³/µL, BILIRUBIN 0–60 mg/dL, CREATININE 0–30 mg/dL, PAO2_FIO2 20–700 — engineering bounds against a slipped digit or a unit slip, not clinical thresholds. Charted support also reaches the alerting SOFA (`rules/sofa.py:195`), which reads the same code. | Today the 3–4 point respiratory bands cannot be reached from charting; a lab value has no bound at all. |
| D5 | **Correcting a recorded value** keeps the backend's rule: the value only, a reason of ≥ `MIN_REASON_CHARS` (20) shown as a counter, points re-scored by the server. A correction is offered only for a measured input; an unmeasured one is completed (D3). | Unchanged backend contract; the form never asks for points. |
| D6 | **Preview, then sign:** `POST /scores/sofa/{id}` takes `preview: true` in its body — the same parsing and re-scoring, the rebuilt form returned with `signed: false`, **no** audit row. The modal shows the previewed total and rows; «İmzala» then sends the same corrections without `preview`. Both need `scores.sign`; a device is refused for both. | A clinician should see the exact number they sign; the server stays the only scorer. |
| D7 | **The last signature in the form's answer:** `GET /scores/sofa/{id}` adds `last_signed` — `{total, auto_total, signed_by, at, corrections}` from the patient's newest `score_signed` audit row, or null — and `min_reason_chars`. Read with the form's own permission (`board.view`, patient scope): only this patient's signing rows, not the trail. | The box's «İmzalandı» line; no second request, no audit permission for a ward doctor. |
| D8 | **Urine output stays out of the renal score.** The form says so under the renal row («idrar çıkışı bu formda puana katılmıyor»). | The source's renal limb includes urine output (<500 / <200 mL/day), but a day's sum from partial charting would read as oliguria and overstate failure. Open item O2. |
| D9 | **MAP is not entered here.** The cardiovascular row takes MAP from the record (unmeasured while no monitor feeds the real engine) and the pressors from A3's charting. | Bedside vitals entry is Group 3's; the shadow engine's monitor values are not the record. Open item O3. |
| D10 | **Nothing else changes:** no alert, no notification, no bell; the window is 24 h; no «dünden +N» comparison; four languages (az default, tr, ru, en) with the parity and az≠tr rules; labelled inputs, the refusal in text as well as the toast, keyboard-only use, phone width. | SOFA here is prognostic (`sofa_form.py` docstring); the alerting use stays in `rules/septic_shock.py`. |
| D11 | **Units of creatinine and bilirubin: see O1 (owner question).** The engine records mg/dL. Until O1 is answered the form prints the unit on each input and relies on D4's bounds; a µmol/L creatinine (≥ 30) is refused, a µmol/L bilirubin is not (17 µmol/L would be read as 17 mg/dL, 4 points). | A unit slip on bilirubin is silent; the lab's unit decides the fix. |

## 3. Components

- `homunculus-engine/src/homunculus/api/clinical.py` — `CHARTABLE[ON_RESP_SUPPORT] = "bool"`, `_BOOLEAN`, the four
  `PLAUSIBLE` bounds (D4).
- `homunculus-engine/src/homunculus/api/app.py` — `sofa_severity_form`: `last_signed` and `min_reason_chars` (D7);
  `sign_sofa_form`: `preview` (D6, no audit row, same refusals).
- `dashboard/src/live/screens/patient/sofa/` — `SofaBox.jsx` (D1), `SofaFormModal.jsx` (D2, D3, D5, D6),
  `sofaFields.js` (organ order, codes, units, the input bounds mirroring `PLAUSIBLE`, the measurement-time rule), tests.
- `dashboard/src/backendApi.js` — `signSeverityForm` gains `preview`; `boardStore.js` — `sofaForm`, `sofaPreview`,
  `sofaSign` (the board reloads after a chart, as `chart()` does).
- `dashboard/src/live/i18n/strings/patient.js` (or a new `sofa.js` namespace) — the strings, four languages.
- `PatientScreen.jsx` — the box in place of the "formsSoon" note.
- Docs: `docs/homunculus-rehber-TR.md` (the form, what it does not do), the roadmap row G2-A4.

## 4. Tests

- Engine (no DB): `ON_RESP_SUPPORT` charted as 1/0 and refused as 2; the four bounds refuse a value outside them; the
  respiration row reaches 3/4 points with charted support; GET carries `last_signed` (null, then the newest signature)
  and `min_reason_chars`; `last_signed` reads only this patient's `score_signed` rows; preview returns the rebuilt
  form, writes no audit row, refuses a short reason, a device and a caller without `scores.sign` exactly as signing does.
- Dashboard: the box's three states (no form, unsigned, signed); the six rows with "ölçülmedi" and the failure mark;
  completing a row charts and re-reads; the correction's counter and refusal; preview then sign; the controls hidden
  without `clinical.chart` / `scores.sign`; the measurement-time bounds; the four languages and parity.
- Gates: engine no-DB, dashboard vitest, `vite build`.

## 5. Out of scope

The urine-output limb (O2), MAP entry (O3), a SOFA history or trend, «dünden +N», APACHE/PRISM/SNAP (they wait for
their tables), a lab feed, any VM deploy (with the next deploy, on the owner's word).

## 6. Open items

- **O1 (owner question)** Which unit does the hospital's laboratory report creatinine and bilirubin in — mg/dL or
  µmol/L? If µmol/L, the form takes µmol/L and converts with the fixed factors (creatinine 88.4, bilirubin 17.1 µmol/L per
  mg/dL), showing the converted value before it is charted; if both occur, a unit selector per input.
- **O2** Urine output in the renal limb needs a complete day of charted output; a rule for "complete" is a clinical
  decision.
- **O3** MAP from the monitors reaches only the shadow engine; whether the real form may read it is Aşama C's question.
- **O4** Each form read appends a `score` audit row (`read_by`); opening, completing and previewing read it several
  times. Kept (a read of a severity form is worth recording); revisit if the audit grows noisy.

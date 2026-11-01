// src/live/screens/patient/sofa/sofa.testutil.js — test-only: the SOFA form as the engine answers it
// (GET /scores/sofa/{id}: scoring/sofa_form.py `as_dict` with G2-A4's `last_signed` and `min_reason_chars`;
// the POST with `preview: true`; the signing POST), with synthetic values. The rows come in the ENGINE's
// build order (respiration, cardiovascular, then coagulation, liver, cns, renal), which the screen must put
// in the source's. Times are against data/board.testutil.js's NOW (2026-10-08T10:00Z): measured 2 h 30 min
// before it, signed 2 min before.
export const MEASURED_AT = "2026-10-08T07:30:00+00:00";
export const SIGNED_AT = "2026-10-08T09:58:00+00:00";
/** A reason long enough for the engine's 20 characters. */
export const WHY = "Laboratuvar sonucu esas alındı, cihaz değeri hatalı";

/** One input cell (scoring/worst.py `WorstValue.as_dict`); a `value` of null is an unmeasured one. */
export function cell(code, value, over = {}) {
  const measured = value !== null;
  return {
    code, value, at: measured ? MEASURED_AT : null, points: 0, source: measured ? "clinician" : "",
    considered: measured ? 1 : 0, measured, outside_window: false, overridden: false, original: null,
    ...over,
  };
}

/** The form: respiration 2 (PaO₂/FiO₂ 250), coagulation 3 (platelets 45, organ failure), the other four
 *  organs unmeasured — total 5. */
export function sofaForm(over = {}) {
  return {
    patient_id: "S-001", score: "SOFA", source: "sepsis-3-jama-2016", total: 5,
    rows: [
      { organ: "respiration", points: 2, measured: true, failure: false, inputs: [cell("pao2_fio2", 250, { points: 2 })] },
      { organ: "cardiovascular", points: 0, measured: false, failure: false, inputs: [cell("map", null)] },
      { organ: "coagulation", points: 3, measured: true, failure: true, inputs: [cell("platelets", 45, { points: 3 })] },
      { organ: "liver", points: 0, measured: false, failure: false, inputs: [cell("bilirubin", null)] },
      { organ: "cns", points: 0, measured: false, failure: false, inputs: [cell("gcs", null)] },
      { organ: "renal", points: 0, measured: false, failure: false, inputs: [cell("creatinine", null)] },
    ],
    window_hours: 24, window_from: "2026-10-07T10:00:00+00:00", window_to: "2026-10-08T10:00:00+00:00",
    unmeasured_organs: ["cardiovascular", "liver", "cns", "renal"], covers_full_window: true,
    organ_failures: ["coagulation"], corrected_cells: [], signed: false,
    last_signed: null, min_reason_chars: 20,
    ...over,
  };
}

/** The engine's answer to `preview: true` with the platelet count corrected from 45 to 80: coagulation
 *  re-scored to 2, the total 4 (api/app.py `sign_sofa_form`, G2-A4). */
export function previewAnswer() {
  const { last_signed: _signed, min_reason_chars: _min, ...base } = sofaForm();   // the preview's form is `rebuilt.as_dict()`
  const rows = base.rows.map((row) => (row.organ !== "coagulation" ? row : {
    ...row, points: 2, failure: false,
    inputs: [cell("platelets", 80, { points: 2, at: null, source: "hekim", overridden: true, original: 45 })],
  }));
  return {
    preview: true, signed: false, total: 4, auto_total: 5,
    overrides: [{ code: "platelets", value: 80, reason: WHY, original: 45 }],
    form: { ...base, rows, total: 4, organ_failures: [], corrected_cells: ["platelets"], auto_total: 5 },
  };
}

/** The signing answer (scoring/signing.py `SignedScore.as_dict`) for the same correction, `total` as given. */
export function signedAnswer({ total = 4 } = {}) {
  const { form, overrides } = previewAnswer();
  return {
    patient_id: "S-001", score: "SOFA", total, signed_by: "dr.elif", signed_at: SIGNED_AT, signed: true,
    overrides, form: { ...form, total, signed: true },
  };
}

/** The box's last signature (D7) after that signature. */
export const LAST_SIGNED = Object.freeze({ total: 4, auto_total: 5, signed_by: "dr.elif", at: SIGNED_AT, corrections: 1 });

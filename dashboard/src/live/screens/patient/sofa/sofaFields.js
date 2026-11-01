// src/live/screens/patient/sofa/sofaFields.js — what the SOFA form shows and what it may write (G2-A4).
//
// THE ROWS IN THE SOURCE'S ORDER (D2) — respiration, coagulation, liver, cardiovascular, CNS, renal, as the
// table in Homunculus/wiki/concepts/sofa-score.md lists them — not the order the engine builds them in
// (scoring/sofa_form.py builds respiration and cardiovascular first, because those two are not one value).
// A clinician checks the form against the table she knows; the order is the table's.
//
// THE INPUTS, by the engine's code: the label and the unit every cell is printed with and, for the six the
// form completes (D3), the door's bounds — api/clinical.py PLAUSIBLE, mirrored only to hold a slipped digit
// back before it is sent; the server stays authoritative. Creatinine and bilirubin are mg/dL, the unit the
// laboratory reports and the engine reads (D11): the unit is printed beside the value and in the field's
// label, and nothing converts. No band, no threshold, no point lives here: the browser scores nothing
// (Decision 1), and every point on the form is the engine's.
//
// The number rule and the time rule are the Meds form's (meds/medsFields.js), imported rather than copied:
// one "plain decimal" and one "up to 24 h back, never ahead" across the patient screen's charting.
import { dayStamp } from "../../../i18n/dates.js";
import { BACKDATE_MS, PRESSORS, fromLocalInput, number } from "../meds/medsFields.js";

export { BACKDATE_MS, toLocalInput } from "../meds/medsFields.js";

/** Own properties only: an engine code such as "constructor" is not an input this build knows. */
const own = (table, key) => (Object.prototype.hasOwnProperty.call(table, key) ? table[key] : null);

/** The six organs in the source table's order, each with its name and the note printed under its row:
 *  what charted support changes (respiration), MAP not entered here (D9), urine output not scored (D8). */
export const ORGANS = Object.freeze([
  Object.freeze({ organ: "respiration", labelKey: "sofa.organRespiration", noteKey: "sofa.respNote" }),
  Object.freeze({ organ: "coagulation", labelKey: "sofa.organCoagulation", noteKey: null }),
  Object.freeze({ organ: "liver", labelKey: "sofa.organLiver", noteKey: null }),
  Object.freeze({ organ: "cardiovascular", labelKey: "sofa.organCardiovascular", noteKey: "sofa.cardioNote" }),
  Object.freeze({ organ: "cns", labelKey: "sofa.organCns", noteKey: null }),
  Object.freeze({ organ: "renal", labelKey: "sofa.organRenal", noteKey: "sofa.renalNote" }),
]);

/** The six inputs the form completes through POST /clinical/{id} (D3, D4), with the door's bounds — the
 *  engine's PLAUSIBLE as the G2-A4 review raised it (platelets 0–5000, creatinine 0–40), which a correction
 *  is held to as well (X7). `on_resp_support` is a flag the door takes as 1 or 0; it is no cell of the form —
 *  it decides which PaO₂/FiO₂ bands apply — so it is charted from under the respiration row. GCS has no unit:
 *  its label says GCS, and "points" would be the word the form uses for the SOFA score's own points. */
export const ENTERABLE = Object.freeze({
  pao2_fio2: Object.freeze({ labelKey: "sofa.inPf", unitKey: "board.unitMmhg", min: 20, max: 700 }),
  on_resp_support: Object.freeze({ labelKey: "sofa.inSupport", flag: true }),
  platelets: Object.freeze({ labelKey: "sofa.inPlatelets", unitKey: "sofa.unitPlatelets", min: 0, max: 5000 }),
  bilirubin: Object.freeze({ labelKey: "sofa.inBilirubin", unitKey: "sofa.unitMgdl", min: 0, max: 60 }),
  gcs: Object.freeze({ labelKey: "sofa.inGcs", min: 3, max: 15 }),
  creatinine: Object.freeze({ labelKey: "sofa.inCreatinine", unitKey: "sofa.unitMgdl", min: 0, max: 40 }),
});

/** The cardiovascular row's inputs, which the form shows and may correct but never completes (D9: MAP comes
 *  from the record, the pressors from the Meds box): the board's MAP words, and the Meds form's drug names,
 *  unit and bounds. MAP has no bound at the door and has none here. */
const OTHER_INPUTS = Object.freeze({
  map: Object.freeze({ labelKey: "board.chMap", unitKey: "board.unitMmhg" }),
  ...Object.fromEntries(PRESSORS.map((p) => [
    p.code, Object.freeze({ labelKey: p.labelKey, unitKey: "patient.medsRateUnit", min: p.min, max: p.max }),
  ])),
});

const specOf = (code) => own(ENTERABLE, code) ?? own(OTHER_INPUTS, code);

/** Is this an input the form completes (D3)? */
export const isEnterable = (code) => own(ENTERABLE, code) !== null;

/** Is this input the support flag, charted as yes or no? */
export const isFlag = (code) => own(ENTERABLE, code)?.flag === true;

/** An input's label and unit in the reader's words. A code this build does not know is printed as the
 *  engine's own code, with no unit — never a guess. */
export function labelOf(t, code) {
  const spec = specOf(code);
  return { label: spec ? t(spec.labelKey) : String(code ?? "—"), unit: spec?.unitKey ? t(spec.unitKey) : "" };
}

/** The engine's rows in the source's order. A row the engine did not send is left out, never drawn empty;
 *  an organ this build does not know is not drawn. */
export function rowsInOrder(form) {
  const rows = Array.isArray(form?.rows) ? form.rows : [];
  return ORGANS
    .map((o) => ({ ...o, row: rows.find((r) => r?.organ === o.organ) ?? null }))
    .filter((o) => o.row !== null);
}

/** What the RECORD holds for an input — the value a correction replaces (D5) — as the engine last sent the
 *  form: a corrected cell's original, else the cell's value; null when the form has no such cell. Read at
 *  each render, so a held correction always names the record's current value. */
export function recordedOf(form, code) {
  for (const row of Array.isArray(form?.rows) ? form.rows : []) {
    for (const c of Array.isArray(row?.inputs) ? row.inputs : []) {
      if (c?.code === code) return c.overridden ? c.original : c.value;
    }
  }
  return null;
}

/** A typed value for `code`, checked as the door checks it: `{ value }` or `{ error: { key, params? } }`. One
 *  check for completing (D3) and correcting (D5, X7): a slipped digit is the same slip whether it is charted
 *  or typed over a recorded value. The flag takes the select's "1" or "0". */
export function checkValue(code, raw) {
  const spec = specOf(code);
  if (spec?.flag) return raw === "1" || raw === "0" ? { value: Number(raw) } : { error: { key: "sofa.supportEmpty" } };
  const n = number(raw);
  if (n === "") return { error: { key: "sofa.valueEmpty" } };
  if (Number.isNaN(n)) return { error: { key: "sofa.notNumber" } };
  if (spec && Number.isFinite(spec.min) && (n < spec.min || n > spec.max)) {
    return { error: { key: "sofa.outOfRange", params: { low: spec.min, high: spec.max } } };
  }
  return { value: n };
}

/** A minute of skew between this browser's clock and the server's is not "ahead" (the Meds form's minute). */
const SKEW_MS = 60_000;

/** A completion's measurement time (D3): `{ recordedAt }` — a UTC instant, which carries a zone (the door
 *  refuses a stamp without one) — or `{ error }`: up to 24 h back, never ahead. `local` is the
 *  `datetime-local` value in the browser's zone; `now` the browser's clock in ms. */
export function checkTime(local, now) {
  const at = fromLocalInput(local);
  if (!Number.isFinite(at)) return { error: { key: "sofa.atInvalid" } };
  if (at > now + SKEW_MS) return { error: { key: "sofa.atFuture" } };
  if (at < now - BACKDATE_MS) return { error: { key: "sofa.atTooOld" } };
  return { recordedAt: new Date(at).toISOString() };
}

/** A correction's reason counted as the engine counts it (scoring/signing.py: the stripped text's `len`) —
 *  in characters, not UTF-16 units. */
export const reasonCount = (reason) => [...String(reason ?? "").trim()].length;

/** The corrections as the engine takes them, `[{code, value, reason}]` in the order they were made — ONE list
 *  for the preview and the signature, so what is signed is what was previewed (D6). */
export function overridesOf(corrections) {
  return Object.entries(corrections).map(([code, c]) => ({ code, value: c.value, reason: String(c.reason).trim() }));
}

/** A set of corrections as one string: a preview is the signature's only while this is unchanged (X12). */
export const correctionsKey = (corrections) => JSON.stringify(overridesOf(corrections));

/** Where a cell's value came from, in the reader's words: a clinician's charting (`clinician`, the door's
 *  provenance), a correction (`hekim`, the engine's mark on a re-scored cell), or the device's id as the
 *  engine wrote it. Nothing for an unmeasured cell. */
export function sourceText(t, source) {
  if (!source) return "";
  if (source === "clinician") return t("sofa.srcClinician");
  if (source === "hekim") return t("sofa.srcCorrection");
  return String(source);
}

/** An engine stamp as `dayStamp` writes it — the reader's clock time, with its day and month when it is not
 *  `nowMs`'s day: a signature from yesterday must not read as this morning's (X5) — or "" when it does not
 *  parse. */
export function stampOf(iso, nowMs) {
  const ms = typeof iso === "string" ? Date.parse(iso) : Number.NaN;
  return Number.isFinite(ms) ? dayStamp(ms, nowMs) : "";
}

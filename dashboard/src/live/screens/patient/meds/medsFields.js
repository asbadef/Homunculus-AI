// src/live/screens/patient/meds/medsFields.js — the inputs the Meds box charts (G2-A3, D1, D6):
// the engine's codes, the door's bounds (api/clinical.py PLAUSIBLE, mirrored here only to hold a
// slipped decimal back — the server stays authoritative, and the precision is the engine's) and the
// strings each reads.
export const PRESSORS = Object.freeze([
  { key: "norepinephrine", code: "norepinephrine_rate", labelKey: "patient.medsDrugNorepinephrine", min: 0, max: 20 },
  { key: "epinephrine", code: "epinephrine_rate", labelKey: "patient.medsDrugEpinephrine", min: 0, max: 20 },
  { key: "dopamine", code: "dopamine_rate", labelKey: "patient.medsDrugDopamine", min: 0, max: 100 },
  { key: "dobutamine", code: "dobutamine_rate", labelKey: "patient.medsDrugDobutamine", min: 0, max: 100 },
]);
export const BOLUS = Object.freeze({ code: "crystalloid_bolus_ml", min: 0, max: 10000 });
export const WEIGHT = Object.freeze({ code: "weight_kg", min: 0.3, max: 400 });
export const ANTIBIOTIC = Object.freeze({ code: "antibiotic_administered" });
export const BACKDATE_MS = 24 * 60 * 60 * 1000;

/** A typed number: "" when empty, its number (a decimal comma read as a point), NaN when not a plain
 *  finite non-negative decimal — the BaselineForm rule, without the sign (no dose is negative). */
export function number(raw) {
  const s = String(raw ?? "").trim().replace(",", ".");
  if (s === "") return "";
  if (!/^\d+(\.\d+)?$/.test(s)) return Number.NaN;
  const n = Number(s);
  return Number.isFinite(n) ? n : Number.NaN;
}

/** What the form would send and each field's problem `{ key, params? }` by field name (D6). `now` is
 *  the browser's clock in ms. `draft`: { pressor: key|"", rate, bolus, weight, antibiotic: bool,
 *  at: "YYYY-MM-DDTHH:MM" }. */
export function checkDraft(draft, now) {
  const errors = {};
  const entries = [];
  const pressor = PRESSORS.find((p) => p.key === draft.pressor) ?? null;
  const rate = number(draft.rate);
  if (pressor && rate === "") errors.rate = { key: "patient.medsPressorNeedsRate" };
  else if (!pressor && rate !== "") errors.pressor = { key: "patient.medsRateNeedsPressor" };
  else if (pressor && Number.isNaN(rate)) errors.rate = { key: "patient.medsNotNumber" };
  else if (pressor && (rate < pressor.min || rate > pressor.max)) errors.rate = { key: "patient.medsOutOfRange", params: { low: pressor.min, high: pressor.max } };
  else if (pressor) entries.push({ code: pressor.code, value: rate });
  for (const [field, spec] of [["bolus", BOLUS], ["weight", WEIGHT]]) {
    const n = number(draft[field]);
    if (n === "") continue;
    if (Number.isNaN(n)) errors[field] = { key: "patient.medsNotNumber" };
    else if (n < spec.min || n > spec.max) errors[field] = { key: "patient.medsOutOfRange", params: { low: spec.min, high: spec.max } };
    else entries.push({ code: spec.code, value: n });
  }
  if (draft.antibiotic) entries.push({ code: ANTIBIOTIC.code, value: 1 });
  const at = fromLocalInput(draft.at);
  if (!Number.isFinite(at)) errors.at = { key: "patient.medsAtInvalid" };
  else if (at > now + 60_000) errors.at = { key: "patient.medsAtFuture" };       // a minute of skew is not "the future"
  else if (at < now - BACKDATE_MS) errors.at = { key: "patient.medsAtTooOld" };
  const empty = entries.length === 0 && Object.keys(errors).length === 0;
  return { errors, entries, empty, recordedAt: Number.isFinite(at) ? new Date(at).toISOString() : null };
}

/** `datetime-local` ↔ instant, in the browser's zone. The ISO sent is UTC ("Z"), which carries a zone
 *  (the door refuses a stamp without one). */
export function toLocalInput(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function fromLocalInput(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(value ?? ""))) return Number.NaN;
  return new Date(value).getTime();          // parsed as local time by the browser
}

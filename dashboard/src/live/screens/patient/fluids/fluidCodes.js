// src/live/screens/patient/fluids/fluidCodes.js — the fluid ledger's eight codes (G3-03 D2), in the engine's
// order (api/fluids.py INTAKE, OUTPUT), the door's bounds (api/clinical.py, mirrored here only to hold a slipped
// digit back — the server stays authoritative) and how a volume is written.
//
// The browser adds no clinical number (G2-A3 Decision 1, spec D6): every total, shift, day, hour, balance and rate
// on the box is the engine's — an hour's bar is its `in_ml` / `out_ml` (review round 1), never a sum made here.
import { numberText } from "../../../i18n/numbers.js";
import { BACKDATE_MS, BOLUS, fromLocalInput } from "../meds/medsFields.js";

export const INTAKE = Object.freeze(["iv_fluid_ml", "crystalloid_bolus_ml", "enteral_ml", "blood_product_ml", "other_intake_ml"]);
export const OUTPUT = Object.freeze(["urine_output_ml", "drain_output_ml", "other_output_ml"]);
export const FLUID_CODES = Object.freeze([...INTAKE, ...OUTPUT]);
/** The Meds box's bolus (G2-A3): the same code, the same record, its own wider bound. */
export const BOLUS_CODE = BOLUS.code;
/** The door's ceiling per entry: 5000 mL, the bolus G2-A3's 10000 mL. */
export const PER_ENTRY_MAX_ML = 5000;

export const isFluidCode = (code) => FLUID_CODES.includes(code);
export const boundOf = (code) => (code === BOLUS_CODE ? BOLUS.max : PER_ENTRY_MAX_ML);
export const labelKey = (code) => `sivi.code.${code}`;

/** A volume as the reader writes it: the reader's decimal, at most one decimal place — the JSON sum of 0.1 and
 *  0.2 is 0.30000000000000004, which is noise, not a number the engine meant. A missing value is a dash. */
export function mlText(lang, value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return numberText(lang, Math.round(value * 10) / 10);
}

/** A balance with its sign: «+430», «−200» (the minus sign, not a hyphen), «0». */
export function signedMlText(lang, value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const rounded = Math.round(value * 10) / 10;
  if (rounded > 0) return `+${numberText(lang, rounded)}`;
  if (rounded < 0) return `−${numberText(lang, -rounded)}`;
  return "0";
}

/** A typed volume the door would take: a plain decimal with at most one place, a comma read as a point. */
const ML_TEXT = /^\d+([.,]\d)?$/;
/** A minute of skew between this browser's clock and the server's is not «ahead» (the Meds form's rule). */
const SKEW_MS = 60_000;

/** One dialog row `{ code, ml, at }` (`at` a `datetime-local` value) as of `now`: its problems by field — `ml`
 *  `{ key: "sivi.invalidMl", params: { max } }`, `at` `{ key: "sivi.invalidAt" }` — the entry it would send and
 *  the instant, as UTC ISO, it would be sent at. Mirrors the door (D2, D3) only to hold a slip back. */
export function checkRow(row, now) {
  const errors = {};
  const raw = String(row?.ml ?? "").trim();
  const max = boundOf(row?.code);
  const value = ML_TEXT.test(raw) ? Number(raw.replace(",", ".")) : Number.NaN;
  if (!Number.isFinite(value) || value < 0 || value > max) errors.ml = { key: "sivi.invalidMl", params: { max } };
  const at = fromLocalInput(row?.at);
  if (!Number.isFinite(at) || at > now + SKEW_MS || at < now - BACKDATE_MS) errors.at = { key: "sivi.invalidAt" };
  return {
    errors,
    entry: errors.ml ? null : { code: row.code, value },
    atIso: errors.at ? null : new Date(at).toISOString(),
  };
}

/** Checked rows grouped by their instant, in the order the rows were written: one `/clinical` request per group,
 *  every row of a group in it (all or nothing). `rows` are the indexes of the rows each group carries. */
export function groupByTime(checked) {
  const groups = [];
  checked.forEach((c, i) => {
    let group = groups.find((g) => g.atIso === c.atIso);
    if (!group) {
      group = { atIso: c.atIso, entries: [], rows: [] };
      groups.push(group);
    }
    group.entries.push(c.entry);
    group.rows.push(i);
  });
  return groups;
}

// src/live/screens/patient/fluids/fluidCodes.js — the fluid ledger's eight codes (G3-03 D2), in the engine's
// order (api/fluids.py INTAKE, OUTPUT), the door's bounds (api/clinical.py, mirrored here only to hold a slipped
// digit back — the server stays authoritative) and how a volume is written.
//
// The browser adds no clinical number (G2-A3 Decision 1): every total, shift, day, balance and rate on the box is
// the engine's. The one sum here, `hourTotals`, lays an hour's per-code volumes end to end so a bar can be drawn
// and titled — the answer carries the hour by code (spec §3) and no hour total.
import { numberText } from "../../../i18n/numbers.js";
import { BOLUS } from "../meds/medsFields.js";

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

const sumOf = (byCode) => Object.values(byCode ?? {}).reduce((sum, v) => (typeof v === "number" && Number.isFinite(v) ? sum + v : sum), 0);

/** One hour row's intake and output, its per-code volumes laid end to end — for the bar and its title only. */
export function hourTotals(hour) {
  return { in: sumOf(hour?.in), out: sumOf(hour?.out) };
}

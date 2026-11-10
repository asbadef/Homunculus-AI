// Test-only: GET /patients/{id}/fluids as the engine answers it (spec §3, homunculus-engine api/fluids.py
// `patient_fluids`), on synthetic entries. The fluid day starts six hours before NOW (board.testutil's
// 2026-10-08T10:00Z → 04:00Z, 08:00 in Baku); shift A is its first twelve hours. Every sum below is written
// out by hand, as the engine would send it — the box adds nothing.
import { NOW } from "../../../data/board.testutil.js";

export const H = 3_600_000;
const iso = (ms) => new Date(ms).toISOString();

export const DAY_START = NOW - 6 * H;
export const LAST_DAY_START = DAY_START - 24 * H;

/** Today's entries, newest first (the engine's order), and one of the last day's. */
export const ENTRIES = [
  { entry: 105, code: "urine_output_ml", value: 200, at: iso(DAY_START + 5 * H), by: "hem.ayse", retracted: null },
  { entry: 104, code: "drain_output_ml", value: 80, at: iso(DAY_START + 4 * H), by: "hem.ayse",
    retracted: { reason: "yanlış hastaya girildi", by: "hem.ayse", at: iso(DAY_START + 4 * H + 600_000) } },
  { entry: 103, code: "crystalloid_bolus_ml", value: 500, at: iso(DAY_START + 3 * H + 15 * 60_000), by: "dr.vusal", retracted: null },
  { entry: 102, code: "urine_output_ml", value: 120, at: iso(DAY_START + H + 30 * 60_000), by: "hem.ayse", retracted: null },
  { entry: 101, code: "iv_fluid_ml", value: 250, at: iso(DAY_START + H + 10 * 60_000), by: "hem.ayse", retracted: null },
  { entry: 90, code: "urine_output_ml", value: 300, at: iso(DAY_START - 5 * H), by: "hem.leyla", retracted: null },
];

const ZERO = Object.freeze({ in: 0, out: 0, balance: 0, by_code: {} });

function hours() {
  const rows = Array.from({ length: 24 }, (_, h) => ({ start: iso(DAY_START + h * H), in: {}, out: {}, balance_cum: 0 }));
  const cum = [0, 130, 130, 630, 630];
  rows.forEach((row, h) => { row.balance_cum = h < cum.length ? cum[h] : 430; });
  rows[1].in = { iv_fluid_ml: 250 };
  rows[1].out = { urine_output_ml: 120 };
  rows[3].in = { crystalloid_bolus_ml: 500 };
  rows[5].out = { urine_output_ml: 200 };
  return rows;
}

/** The answer for `patientId`, with `over` laid on top (a key at a time). */
export function fluids(patientId = "S-001", over = {}) {
  return {
    patient_id: patientId, now: iso(NOW),
    day: { start: iso(DAY_START), end: iso(DAY_START + 24 * H) },
    last_day: { start: iso(LAST_DAY_START), end: iso(DAY_START) },
    shifts: [{ start: iso(DAY_START), end: iso(DAY_START + 12 * H) }, { start: iso(DAY_START + 12 * H), end: iso(DAY_START + 24 * H) }],
    codes: {
      intake: ["iv_fluid_ml", "crystalloid_bolus_ml", "enteral_ml", "blood_product_ml", "other_intake_ml"],
      output: ["urine_output_ml", "drain_output_ml", "other_output_ml"],
    },
    hours: hours(),
    totals: {
      today: { in: 750, out: 320, balance: 430, by_code: { iv_fluid_ml: 250, crystalloid_bolus_ml: 500, urine_output_ml: 320 } },
      shift_a: { in: 750, out: 320, balance: 430, by_code: { iv_fluid_ml: 250, crystalloid_bolus_ml: 500, urine_output_ml: 320 } },
      shift_b: ZERO,
      last_day: { in: 1800, out: 1480, balance: 320, by_code: { iv_fluid_ml: 1800, urine_output_ml: 1480 } },
    },
    urine_last_day_ml: 1480, hours_with_urine_last_day: 18,
    weight_kg: 72, urine_ml_kg_h_last_6h: 0.74,
    sofa_renal_reference: { source: "sepsis-3-jama-2016", bands: [{ below_ml_day: 500, points: 3 }, { below_ml_day: 200, points: 4 }] },
    entries: ENTRIES,
    ...over,
  };
}

/** An empty ledger: nothing charted in either day. */
export function emptyFluids(patientId = "S-001") {
  return fluids(patientId, {
    hours: hours().map((row) => ({ ...row, in: {}, out: {}, balance_cum: 0 })),
    totals: { today: ZERO, shift_a: ZERO, shift_b: ZERO, last_day: ZERO },
    urine_last_day_ml: 0, hours_with_urine_last_day: 0, weight_kg: null, urine_ml_kg_h_last_6h: null, entries: [],
  });
}

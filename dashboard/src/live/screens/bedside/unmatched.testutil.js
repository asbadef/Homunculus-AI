// Test-only: GET /readings/unmatched as the engine answers it (spec §4, homunculus-engine api/readings.py
// `unmatched_sets`), on synthetic sets. Two wait: a round typed under a number nobody is admitted under, twenty
// minutes before NOW, and one value for a discharged patient's number that is too old to link. The numbers are
// synthetic 12-digit protocols; the device name is made up.
import { NOW } from "../../data/board.testutil.js";

const iso = (ms) => new Date(ms).toISOString();
export const TYPO = "202600000010";
export const GONE = "202600000003";
export const ROUND_AT = NOW - 20 * 60_000;
export const OLD_AT = NOW - 30 * 3_600_000;

export const ROUND = {
  received_key: TYPO, reason: "unknown", source: "CONNEX-3A", observed_at: iso(ROUND_AT), received_at: iso(ROUND_AT + 15_000),
  linkable: true,
  readings: [{ id: 7, code: "heart_rate", value: 88, unit: "/min" }, { id: 8, code: "spo2", value: 97, unit: "%" }],
};
export const OLD = {
  received_key: GONE, reason: "discharged", source: "CONNEX-3B", observed_at: iso(OLD_AT), received_at: iso(OLD_AT + 15_000),
  linkable: false,
  readings: [{ id: 5, code: "temperature", value: 37.4, unit: "°C" }],
};

/** The answer, newest arrival first; `sets` in place of the two. */
export const unmatched = (sets = [ROUND, OLD]) => ({ count: sets.length, sets });

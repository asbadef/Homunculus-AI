// Test-only: GET /patients/{id}/readings as the engine answers it (spec §4, homunculus-engine api/readings.py
// `patient_readings`), on synthetic values. Three sets, newest first: a hand entry ten minutes before NOW, a
// device round an hour before it — one of its values withdrawn — and a buffered device reading that arrived half
// an hour after it was measured. Protocol 202600000001 and the device name are synthetic.
import { NOW } from "../../../data/board.testutil.js";

const iso = (ms) => new Date(ms).toISOString();
export const MIN = 60_000;
export const HAND_AT = NOW - 10 * MIN;
export const ROUND_AT = NOW - 70 * MIN;
export const LATE_AT = NOW - 5 * 60 * MIN;

const value = (id, code, v, unit, over = {}) => ({
  id, code, value: v, unit, origin: "device", source: "CONNEX-3A", recorded_by: null, entry: 400 + id, voided: null, ...over,
});

export const SETS = [
  {
    observed_at: iso(HAND_AT), received_at: iso(HAND_AT), received_late: false, origin: "manual", source: "clinician",
    recorded_by: "hem.ayse",
    readings: [value(31, "resp_rate", 16, "/min", { origin: "manual", source: "clinician", recorded_by: "hem.ayse" })],
  },
  {
    observed_at: iso(ROUND_AT), received_at: iso(ROUND_AT + 20_000), received_late: false, origin: "device",
    source: "CONNEX-3A", recorded_by: null,
    readings: [
      value(21, "heart_rate", 88, "/min"),
      value(22, "sbp", 188, "mmHg", { voided: { reason: "manşet yanlış koldaydı", by: "hem.ayse", at: iso(ROUND_AT + 8 * MIN) } }),
      value(23, "spo2", 97, "%"),
      value(24, "temperature", 36.8, "°C"),
    ],
  },
  {
    observed_at: iso(LATE_AT), received_at: iso(LATE_AT + 30 * MIN), received_late: true, origin: "device",
    source: "CONNEX-3A", recorded_by: null,
    readings: [value(11, "spo2", 95, "%")],
  },
];

/** The answer for `patientId` and `hours`, with `over` laid on top. */
export function readings(patientId = "S-001", hours = 24, over = {}) {
  return { patient_id: patientId, hours, since: iso(NOW - hours * 60 * MIN), until: iso(NOW), sets: SETS, ...over };
}

export const emptyReadings = (patientId = "S-001", hours = 24) => readings(patientId, hours, { sets: [] });

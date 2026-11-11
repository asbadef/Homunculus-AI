// Test-only: synthetic answers of GET /quality for «Kalite göstergeleri» (G4-03) — the engine's own answer for the
// synthetic trail of homunculus-engine/tests/test_quality_indicators.py (Reanimasiya, Neonatal, two unplaced keys), a
// scoped caller's (Reanimasiya alone) and one who reaches nothing. Unit ids and names are the kabul ward's; no patient
// key, no person and no free text, as the API sends none.
import { NEO, REA } from "../kabul/kabul.testutil.js";

const REASONS = { ARTEFACT_OR_SIGNAL_NOISE: 0, CLINICAL_DECISION_MADE: 0, OTHER: 0, PATIENT_BASELINE: 0, PROCEDURE_IN_PROGRESS: 0 };

/** One block's alarms: zeros and nulls, then what `over` says. */
export const alarms = (over = {}) => ({ episodes: 0, answered: 0, answered_rate: null, median_response_sec: null,
  p90_response_sec: null, escalated: 0, unanswered: 0, unanswered_resolved: 0, pending: 0, per_kind: [], ...over });
/** One block's snoozes: `byReason` counted into `count`, the severities and the median as given. */
export const snoozes = (byReason = {}, { high = 0, moderate = 0, median = null } = {}) => ({
  count: Object.values(byReason).reduce((sum, n) => sum + n, 0), by_reason: { ...REASONS, ...byReason },
  by_severity: { high, moderate }, median_minutes: median });
/** One block's handovers. */
export const handovers = (over = {}) => ({ opened: 0, countersigned: 0, waiting: 0, expired: 0,
  median_countersign_sec: null, p90_countersign_sec: null, ...over });
const kind = (name, episodes, answered, escalated, unanswered, median) => ({ kind: name, episodes, answered, escalated,
  unanswered, median_response_sec: median });

const REA_BLOCK = {
  alarms: alarms({ episodes: 6, answered: 3, answered_rate: 0.6, median_response_sec: 180, p90_response_sec: 600,
    escalated: 1, unanswered: 2, unanswered_resolved: 1, pending: 1,
    per_kind: [kind("news2", 3, 2, 0, 0, 120), kind("spo2_low", 2, 0, 0, 2, null), kind("septic_shock", 1, 1, 1, 0, 600)] }),
  snoozes: snoozes({ CLINICAL_DECISION_MADE: 1, OTHER: 1 }, { high: 1, moderate: 1, median: 12.5 }),
  rrt: { count: 1 },
  handovers: handovers({ opened: 6, countersigned: 2, waiting: 1, expired: 2, median_countersign_sec: 600,
    p90_countersign_sec: 900 }),
};

/** An unrestricted caller's week (the system administrator, the auditor). */
export const ANSWER = Object.freeze({
  days: 7, generated_at: "2026-11-11T10:42:00+00:00", window_from: "2026-11-04T10:42:00+00:00",
  truncated: false, scoped: false,
  coverage: { episodes: 9, placed: 7, unplaced: 2 },
  units: [
    { unit_id: NEO, unit_name: "Neonatal",
      alarms: alarms({ episodes: 1, answered: 1, answered_rate: 1, median_response_sec: 240, p90_response_sec: 240,
        per_kind: [kind("news2", 1, 1, 0, 0, 240)] }),
      snoozes: snoozes({ ARTEFACT_OR_SIGNAL_NOISE: 1 }, { moderate: 1, median: 30 }),
      rrt: { count: 0 },
      handovers: handovers({ opened: 1, countersigned: 1, median_countersign_sec: 60, p90_countersign_sec: 60 }) },
    { unit_id: REA, unit_name: "Reanimasiya", ...REA_BLOCK },
  ],
  unplaced: {
    alarms: alarms({ episodes: 2, answered: 1, answered_rate: 0.5, median_response_sec: 60, p90_response_sec: 60,
      unanswered: 1, per_kind: [kind("news2", 2, 1, 0, 1, 60)] }),
    snoozes: snoozes({ PROCEDURE_IN_PROGRESS: 1 }, { high: 1, median: 5 }),
    rrt: { count: 1 },
  },
  hospital: {
    alarms: alarms({ episodes: 9, answered: 5, answered_rate: 0.625, median_response_sec: 180, p90_response_sec: 240,
      escalated: 1, unanswered: 3, unanswered_resolved: 1, pending: 1,
      per_kind: [kind("news2", 6, 4, 0, 1, 120), kind("spo2_low", 2, 0, 0, 2, null), kind("septic_shock", 1, 1, 1, 0, 600)] }),
    snoozes: snoozes({ ARTEFACT_OR_SIGNAL_NOISE: 1, CLINICAL_DECISION_MADE: 1, OTHER: 1, PROCEDURE_IN_PROGRESS: 1 },
      { high: 2, moderate: 2, median: 12.5 }),
    rrt: { count: 2 },
    handovers: handovers({ opened: 7, countersigned: 3, waiting: 1, expired: 2, median_countersign_sec: 300,
      p90_countersign_sec: 900 }),
  },
});

/** A caller granted Reanimasiya alone: her unit, no unplaced block, the sum of what she got. */
export const SCOPED = Object.freeze({
  ...ANSWER, scoped: true, coverage: { episodes: 6, placed: 6, unplaced: 0 },
  units: [{ unit_id: REA, unit_name: "Reanimasiya", ...REA_BLOCK }], unplaced: null, hospital: REA_BLOCK,
});

/** A caller whose grants reach no unit (a bed grant alone): nothing, and zeros that are the answer's own. */
export const NOTHING = Object.freeze({
  ...ANSWER, scoped: true, coverage: { episodes: 0, placed: 0, unplaced: 0 }, units: [], unplaced: null,
  hospital: { alarms: alarms(), snoozes: snoozes(), rrt: { count: 0 }, handovers: handovers() },
});

export function deferred() {
  let resolve;
  const promise = new Promise((yes) => { resolve = yes; });
  return { promise, resolve };
}

export { NEO, REA };

// Test-only: a synthetic ward for «Eczane» (G3-04) in the shape GET /pharmacy answers (spec §3) — one row in each of
// the six antibiotic states, in the SERVER'S order (which is deliberately not the bed order: the page must not re-sort),
// with vasopressors, a creatinine and a fluid balance. Synthetic names and keys only (CLAUDE.md rule 6).
import { NOW } from "../../data/board.testutil.js";

export { NOW };
export const MIN = 60_000;
/** An ISO instant this many minutes before NOW (negative: after it). */
export const at = (minutesAgo) => new Date(NOW - minutesAgo * MIN).toISOString();

const NONE = { state: "none", given: null, given_at: null, recognized_at: null, deadline: null, remaining_sec: null };

/** One row; `over` replaces whole fields. */
export const row = (patientId, over = {}) => ({
  patient_id: patientId, bed_label: "", bed_id: null, unit_id: "u1", display_name: "", measured: true,
  on_pressor: false, pressors: [], antibiotic: { ...NONE }, creatinine: null, fluid: null, ...over,
});

export const MISSED = row("S-003", {
  bed_label: "YBU 1-3", bed_id: "b3", display_name: "Örnek Hasta Üç",
  antibiotic: { state: "missed", given: null, given_at: null, recognized_at: at(85), deadline: at(25), remaining_sec: -1500 },
  creatinine: { value: 2.1, at: at(260) },
  fluid: { in_ml: 1250, out_ml: 900, balance_ml: 350, entries: 7, last_at: at(30) },
});
export const RUNNING = row("S-004", {
  bed_label: "YBU 1-4", bed_id: "b4", display_name: "Örnek Hasta Dört",
  antibiotic: { state: "running", given: false, given_at: null, recognized_at: at(40), deadline: at(-20), remaining_sec: 1200 },
  fluid: { in_ml: 200, out_ml: 650.5, balance_ml: -450.5, entries: 3, last_at: at(90) },
});
export const MET = row("S-001", {
  bed_label: "YBU 1-1", bed_id: "b1", display_name: "Örnek Hasta Bir", on_pressor: true,
  pressors: [{ drug: "norepinephrine", rate: 0.12, at: at(20) }, { drug: "dopamine", rate: 0, at: at(180) }],
  antibiotic: { state: "met", given: true, given_at: at(170), recognized_at: at(210), deadline: at(150), remaining_sec: null },
});
export const LATE = row("S-005", {
  bed_label: "YBU 1-5", bed_id: "b5", display_name: "Örnek Hasta Beş",
  antibiotic: { state: "late", given: true, given_at: at(100), recognized_at: at(300), deadline: at(240), remaining_sec: null },
});
export const GIVEN = row("S-006", {
  bed_label: "YBU 1-6", bed_id: "b6", display_name: "Örnek Hasta Altı",
  antibiotic: { state: "given", given: true, given_at: at(50), recognized_at: null, deadline: null, remaining_sec: null },
});
/** An identity-only card: admitted, never measured, the HIS has sent no name — and no bed label either. */
export const UNMEASURED = row("S-002", { bed_id: "b2", measured: false });

export const ROWS = [MISSED, RUNNING, MET, LATE, GIVEN, UNMEASURED];
export const SCOPE = { unrestricted: false, reason: "assigned", unit_ids: ["u1"], bed_ids: [], own_patients: 0, hidden: 4,
  unresolved_hidden: 0, unmatched_unit_ids: [], unmatched_bed_ids: [], blind: false };

/** GET /pharmacy; `over` replaces whole top-level fields. */
export const answer = (over = {}) => ({
  now: at(0), antibiotic_window_min: 60, antibiotic_window_source: "surviving-sepsis-campaign-2026",
  fluid_day: { start: at(360), end: at(-1080) }, fluid_truncated: false,
  counts: { patients: 6, clock_running: 1, clock_missed: 1, on_pressor: 1, recognized: 4, recognized_no_record: 2 },
  rows: ROWS, scope: SCOPE, scope_note: null, ...over,
});

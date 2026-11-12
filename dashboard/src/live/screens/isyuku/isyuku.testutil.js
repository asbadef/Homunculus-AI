// Test-only: a synthetic ward for «İş yükü» (G4-04) — two open units and a closed one (GET /tenant/structure), the
// shift's assignment (GET /shift-schedule, also for one unit), the form's people, the task queue (GET /tasks) and the
// live board (GET /patients), as the API sends them. Synthetic names and ids only; no screen may print a patient's
// name, a patient id or a UUID.
import { alarm, board, entry, identity } from "../../data/board.testutil.js";
import { BED, NEO, REA, SITE, T } from "../kabul/kabul.testutil.js";

export { BED, NEO, REA };
/** A closed unit: the page leaves it out. */
export const OLD = "33333333-3333-4333-8333-333333333309";
export const NURSE = Object.freeze({
  aysel: "66666666-6666-4666-8666-666666666601", leyla: "66666666-6666-4666-8666-666666666602",
  zaur: "66666666-6666-4666-8666-666666666603", nigar: "66666666-6666-4666-8666-666666666604",
});
export const PATIENT_NAME = "Ayşe Sentetik";
/** 10:00 UTC on 12 November: inside SHIFT. */
export const NOW_MS = Date.parse("2026-11-12T10:00:00Z");

const bed = (n, label, state = "AVAILABLE", isActive = true) => ({ id: BED(n), label, state, is_active: isActive });
const room = (n, name, beds) => ({ id: `44444444-4444-4444-8444-4444444444${n}`, name, room_number: null,
  is_isolation: false, is_active: true, beds });

/** Reanimasiya: Otaq 1 — beds 1 and 2 occupied, 3 leaving (PENDING_DISCHARGE: still a patient), 4 free; Otaq 2 — bed 5
 *  occupied, bed 6 closed. Neonatal: N-1 — N1 occupied, N2 free. «Köhnə şöbə»: closed. */
export function tree() {
  return { tenant_id: T, sites: [{ id: SITE, name: "Ana bina", is_active: true, units: [
    { id: REA, name: "Reanimasiya", unit_type: "ADULT_ICU", is_active: true, rooms: [
      room(11, "Otaq 1", [bed(1, "1", "OCCUPIED"), bed(2, "2", "OCCUPIED"), bed(3, "3", "PENDING_DISCHARGE"), bed(4, "4")]),
      room(12, "Otaq 2", [bed(5, "5", "OCCUPIED"), bed(6, "6", "AVAILABLE", false)]),
    ] },
    { id: NEO, name: "Neonatal", unit_type: "NICU", is_active: true, rooms: [
      room(13, "N-1", [bed(11, "N1", "OCCUPIED"), bed(12, "N2")]),
    ] },
    { id: OLD, name: "Köhnə şöbə", unit_type: "ADULT_ICU", is_active: false, rooms: [] },
  ] }] };
}

/** The current shift (A, 08:00–20:00 UTC on 12 November) and the next (B). */
export const SHIFT = Object.freeze({ start: "2026-11-12T08:00:00Z", end: "2026-11-12T20:00:00Z", which: "A" });
export const NEXT = Object.freeze({ start: "2026-11-12T20:00:00Z", end: "2026-11-13T08:00:00Z", which: "B" });
const item = (n, nurse, name) => ({ bed_id: BED(n), nurse_id: NURSE[nurse], nurse_name: name,
  nurse_username: `${nurse}@sentetik.example` });

/** GET /shift-schedule: Reanimasiya's beds 1 and 2 to Leyla, 5 to Aysel — and the closed bed 6 to Zaur, a row the page
 *  does not count; Neonatal has none. */
export function schedule(over = {}) {
  return { shift: SHIFT, generated_at: "2026-11-12T10:00:00Z", units: [
    { unit_id: NEO, unit_name: "Neonatal", items: [], other_rows: 0 },
    { unit_id: REA, unit_name: "Reanimasiya", other_rows: 0, items: [item(1, "leyla", "Leyla Sentetik"),
      item(2, "leyla", "Leyla Sentetik"), item(5, "aysel", "Aysel Sentetik"), item(6, "zaur", "Zaur Sentetik")] },
  ], ...over };
}

/** GET /shift-schedule for one unit: «current» as `schedule()` has it, «next» with no row yet. */
export function unitSchedule(shift, unitId) {
  const whole = schedule();
  const unit = whole.units.find((u) => u.unit_id === unitId);
  return { ...whole, shift: shift === "next" ? NEXT : SHIFT,
    units: unit ? [{ ...unit, items: shift === "next" ? [] : unit.items }] : [] };
}

/** GET /shift-schedule/nurses: the tenant's active nurses and charge nurses, by name — Nigar's own grants do not reach
 *  Reanimasiya; Zaur is no longer offered (he holds the closed bed 6 still). */
export const NURSES = Object.freeze([
  { id: NURSE.aysel, name: "Aysel Sentetik", username: "aysel@sentetik.example", reaches_unit: true },
  { id: NURSE.leyla, name: "Leyla Sentetik", username: "leyla@sentetik.example", reaches_unit: true },
  { id: NURSE.nigar, name: "Nigar Sentetik", username: "nigar@sentetik.example", reaches_unit: false },
]);

const task = (id, due, over = {}) => ({ id, patient_id: "", title: "Sentetik görev", due_at: due, target_role: "nurse",
  state: "open", late: false, created_by: "hem.ayse", created_at: "2026-11-12T07:00:00Z", claimed_by: null,
  claimed_at: null, closed_by: null, closed_at: null, ...over });

/** GET /tasks over the week that ends with the shift: S-101 (bed 1) — a late open task, an open one due in the shift, a
 *  done one, and a late vital; S-102 (bed 2) — an open one due in the shift; S-105 (bed 5) — an open one due after the
 *  shift; S-111 (Neonatal's N1) — an open one due in the shift, and a vital due (not late). */
export function tasks() {
  return { from: "2026-11-05T20:00:00Z", to: SHIFT.end, now: "2026-11-12T10:00:00Z",
    shift: { start: SHIFT.start, end: NEXT.end }, settings: { grace_min: 30, intervals: {} },
    patients: [
      { patient_id: "S-101", bed_key: null, unit_id: REA, vital: { state: "late" }, tasks: [
        task("t1", "2026-11-12T09:00:00Z", { late: true }), task("t2", "2026-11-12T15:00:00Z"),
        task("t3", "2026-11-12T09:30:00Z", { state: "done" })] },
      { patient_id: "S-102", bed_key: null, unit_id: REA, vital: null, tasks: [task("t6", "2026-11-12T18:00:00Z")] },
      { patient_id: "S-105", bed_key: null, unit_id: REA, vital: null, tasks: [task("t4", "2026-11-12T21:00:00Z")] },
      { patient_id: "S-111", bed_key: null, unit_id: NEO, vital: { state: "due" }, tasks: [task("t5", "2026-11-12T12:00:00Z")] },
    ] };
}

const card = (id, n, unitId, alarms = []) => entry(id, alarms,
  { identity: identity({ patient_id: id, display_name: PATIENT_NAME, unit_id: unitId, bed_id: BED(n) }) });
/** GET /patients: S-101 on bed 1 with a critical alarm, S-102 on bed 2, S-105 on bed 5 with a high one, S-111 on N1. */
export const BOARD = board([
  card("S-101", 1, REA, [alarm("septic_shock", "critical")]), card("S-102", 2, REA),
  card("S-105", 5, REA, [alarm("news2", "high")]), card("S-111", 11, NEO),
]);

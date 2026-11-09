// src/live/screens/gorevler/taskModel.js — pure helpers for Görevlerim (G3-02): hour columns, states,
// counters, filters, the session's role. No React, no fetch; tested alone.
export const HOUR_MS = 3_600_000;
//: the order the list shows: what is late first, then what is due, then the rest
const ORDER = { late: 0, due: 1, open: 2, plan: 3, unknown: 4, skipped: 5, done: 6 };
const NURSE_SLUGS = new Set(["nurse", "charge_nurse", "rapid_response"]);
const PHYSICIAN_SLUGS = new Set(["physician", "unit_physician", "attending"]);

export const hourIndex = (iso, shiftStartMs) => Math.floor((Date.parse(iso) - shiftStartMs) / HOUR_MS);

/** A hand task's state as the grid paints it: the server says `state` and `late`; «due» is the open task whose
 *  time has come but whose grace has not run out (the same rule the server applies to the vital task). */
export function handStateOf(task, nowMs, graceMin) {
  if (task.state !== "open") return task.state;
  if (task.late) return "late";
  const due = Date.parse(task.due_at);
  if (nowMs < due) return "plan";
  return nowMs <= due + graceMin * 60_000 ? "due" : "late";
}

/** One patient's answer as flat items. The vital's past entries are `done` items; the vital itself is one item
 *  in its derived state at its due time (now, when it has none); every hand task is one item. */
export function items(patient, nowMs, graceMin) {
  const out = [];
  const v = patient.vital;
  if (v) {
    for (const at of v.entries || []) out.push({ key: `v:${patient.patient_id}:${at}`, kind: "vital", patientId: patient.patient_id, state: "done", at, vital: v });
    out.push({ key: `v:${patient.patient_id}:now`, kind: "vital", patientId: patient.patient_id, state: v.state,
               at: v.due_at ?? new Date(nowMs).toISOString(), vital: v, role: "nurse" });
  }
  for (const task of patient.tasks || []) {
    out.push({ key: `t:${task.id}`, kind: "hand", patientId: patient.patient_id, state: handStateOf(task, nowMs, graceMin), at: task.due_at, task, role: task.target_role });
  }
  return out;
}

export function counters(all) {
  const c = { late: 0, due: 0, plan: 0, done: 0 };
  for (const x of all) if (x.state in c) c[x.state] += 1;
  return c;
}

export function keep(item, filters, role) {
  if (filters.kind !== "all" && item.kind !== filters.kind) return false;
  if (filters.onlyLate && item.state !== "late") return false;
  if (filters.onlyMine && role && item.role && item.role !== "any" && item.role !== role) return false;
  return true;
}

export const sortItems = (all) => [...all].sort((a, b) => (ORDER[a.state] ?? 9) - (ORDER[b.state] ?? 9) || Date.parse(a.at) - Date.parse(b.at));

export function myRole(groups) {
  const slugs = (groups || []).map((g) => g.slug);
  if (slugs.some((s) => NURSE_SLUGS.has(s))) return "nurse";
  if (slugs.some((s) => PHYSICIAN_SLUGS.has(s))) return "physician";
  return null;
}

/** StatusPill tones per state (ui/Tag.jsx): the same five colours the prototype's legend used. */
export const TONE = { late: "crit", due: "att", plan: "neutral", done: "ok", skipped: "low", unknown: "neutral", open: "neutral" };

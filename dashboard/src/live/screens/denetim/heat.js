// src/live/screens/denetim/heat.js — the «Alarm yoğunluğu» box's rules, apart from React (G2-B6, spec
// docs/superpowers/specs/2026-11-09-g2b-b6-alarm-isi-haritasi-design.md): the report's UTC hour starts to local
// hours of the day (D2), rows of masked patients with 24 counts and a total, ordered and capped (D5), and the four
// shading steps — relative to the table, never a clinical threshold.
import { maskPatient } from "./denetim.js";

export const HEAT_DAYS = 7;
export const HEAT_ROWS = 30;
export const HOURS = Object.freeze(Array.from({ length: 24 }, (_, h) => h));

/** The local hour of the day (0–23) a UTC hour start falls in, in the browser's zone (the hospital's on the
 *  ward PCs, as i18n/dates.js); null for one that does not parse. */
export function localHour(iso) {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? new Date(ms).getHours() : null;
}

/** D5: the report's `per_patient_hour` as rows — {patient, label, counts[24], total} — for the patients with at
 *  least one episode, the highest total first (a tie keeps the server's order), at most HEAT_ROWS; with `total`
 *  (how many patients had any) and `max` (the largest shown cell: the shading's only reference). null for an
 *  answer without a `per_patient_hour` array (D6), and for one whose readable cells — ALL of them, before the cap —
 *  do not add up to the report's own `episodes` (review): a cell this browser cannot read must not make a
 *  smaller map pass for the whole one. */
export function heatRows(report) {
  const cells = report?.per_patient_hour;
  if (!Array.isArray(cells)) return null;
  const byPatient = new Map();
  let counted = 0;
  for (const cell of cells) {
    const n = Number(cell?.episodes);
    const hour = localHour(cell?.hour);
    if (!Number.isFinite(n) || n <= 0 || hour === null) continue;
    const id = typeof cell?.patient_id === "string" ? cell.patient_id : "";
    if (!byPatient.has(id)) {
      byPatient.set(id, { patient: id, label: maskPatient(id), counts: new Array(24).fill(0), total: 0 });
    }
    const row = byPatient.get(id);
    row.counts[hour] += n;
    row.total += n;
    counted += n;
  }
  const claimed = report?.episodes;
  if (Number.isFinite(claimed) && counted !== claimed) return null;
  const all = [...byPatient.values()].sort((a, b) => b.total - a.total);   // stable: a tie keeps the server's order
  const rows = all.slice(0, HEAT_ROWS);
  const max = rows.reduce((m, r) => Math.max(m, ...r.counts), 0);
  return { rows, total: all.length, max };
}

/** The instant a truncated window's count starts at — the report's `window_from` (the start of the earliest
 *  episode it counted), in ms; null when it is missing or does not parse. */
export function windowStart(report) {
  const iso = report?.window_from;
  const ms = typeof iso === "string" ? Date.parse(iso) : NaN;
  return Number.isFinite(ms) ? ms : null;
}

/** D5: one cell's shading step — 0 for none, then 1–3 by its share of the table's largest cell. */
export function heatStep(count, max) {
  if (!(count > 0) || !(max > 0)) return 0;
  const share = count / max;
  if (share > 2 / 3) return 3;
  if (share > 1 / 3) return 2;
  return 1;
}

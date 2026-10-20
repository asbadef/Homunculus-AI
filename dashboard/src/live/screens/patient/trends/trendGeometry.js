// src/live/screens/patient/trends/trendGeometry.js — where things go on a trend chart. Pure: no
// React, no DOM, and no clock but the instants it is handed.
//
// NOTHING HERE DECIDES ANYTHING CLINICAL. Every band edge and every point total comes from the
// engine (GET /patients/{id}/trends); this file maps them to pixels and does nothing else. The value
// range a chart spans is the data's own (plus a margin, plus the patient's charted normal so a band a
// clinician just entered is always on the chart) — never a "normal range" of its own. A band is drawn
// where the server put it, clipped to that range, in the tone of the server's points (`news2Tone`,
// the one mapping the card's frame uses too).
import { news2Tone } from "./news2Tone.js";

const LABEL_PAD = 34;   // room for the value labels, big chart only
const EDGE_PAD = 2;
const TOP_PAD = 6;
const BOTTOM_PAD = 6;
export const MARKER_LANE = 14;
export const AXIS_LANE = 16;
// The time-label step per window: hourly over 6 h, every 4 h over 24 h, every 12 h over 3 days.
const TICK_HOURS = { 6: 1, 24: 4, 72: 12 };
const NICE_STEPS = [1, 2, 2.5, 5];

/** The plot area of a `width` × `height` chart. The big chart has value labels on the left, a lane
 *  under the plot for the ▲/◆ marks, and one under that for the time labels. */
export function plotFrame(width, height, { labels = false, markers = false, axis = false } = {}) {
  const left = labels ? LABEL_PAD : EDGE_PAD;
  const right = Math.max(left + 1, width - (labels ? 8 : EDGE_PAD));
  const top = TOP_PAD;
  const bottom = Math.max(top + 1, height - BOTTOM_PAD - (markers ? MARKER_LANE : 0) - (axis ? AXIS_LANE : 0));
  return { left, right, top, bottom, laneY: bottom + BOTTOM_PAD + MARKER_LANE / 2, axisY: height - 4 };
}

/** The endpoint's `[iso, value, points]` rows as `{ ms, iso, value, points }`, in their order. A row
 *  whose instant cannot be read is dropped (it could be drawn nowhere); a value that is not a number
 *  is kept as NaN, which breaks the line there. */
export function parsePoints(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((row) => {
    if (!Array.isArray(row)) return [];
    const ms = Date.parse(row[0]);
    if (!Number.isFinite(ms)) return [];
    return [{ ms, iso: row[0], value: typeof row[1] === "number" ? row[1] : Number.NaN, points: Number.isInteger(row[2]) ? row[2] : null }];
  });
}

/** The response's markers as `{ ms, iso, kind, label }`; unreadable instants dropped. */
export function parseMarkers(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((m) => {
    const ms = Date.parse(m?.ts);
    return Number.isFinite(ms) ? [{ ms, iso: m.ts, kind: m.kind, label: m.label }] : [];
  });
}

/** [sinceMs, untilMs] onto [left, right]. */
export function timeScale(sinceMs, untilMs, left, right) {
  const span = untilMs - sinceMs;
  return (ms) => left + (span > 0 ? ((ms - sinceMs) / span) * (right - left) : 0);
}

/** The value range drawn: the finite values' own, with 15 % either side (±5 % of the value, at least
 *  1, when they are all one number). Null when there is no finite value at all. */
export function valueDomain(values) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (Number.isFinite(v)) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  if (lo > hi) return null;
  const margin = hi > lo ? (hi - lo) * 0.15 : Math.max(Math.abs(hi) * 0.05, 1);
  return { lo: lo - margin, hi: hi + margin };
}

/** The domain onto [bottom, top] (larger values higher). */
export function valueScale(domain, top, bottom) {
  const span = domain.hi - domain.lo;
  return (v) => bottom - ((v - domain.lo) / span) * (bottom - top);
}

function clip(low, high, domain, y, left, right) {
  const a = Math.max(low ?? -Infinity, domain.lo);
  const b = Math.min(high ?? Infinity, domain.hi);
  if (!(b > a)) return null;
  return { x: left, y: y(b), w: right - left, h: y(a) - y(b) };
}

/** The NEWS2 rows that score at least 1, as rectangles clipped to the domain, each in the tone of the
 *  SERVER's points for it. A row scoring 0 is not tinted; a row outside the domain is not drawn. */
export function bandRects(rows, domain, y, left, right) {
  if (!Array.isArray(rows) || !domain) return [];
  return rows.flatMap((row) => {
    const tone = news2Tone(row?.points);
    const rect = tone ? clip(row.low, row.high, domain, y, left, right) : null;
    return rect ? [{ ...rect, tone, points: row.points }] : [];
  });
}

/** The patient's charted normal as a rectangle, or null. */
export function ownNormalRect(own, domain, y, left, right) {
  if (!own || !domain || !Number.isFinite(own.low) || !Number.isFinite(own.high)) return null;
  return clip(own.low, own.high, domain, y, left, right);
}

/** The connector through the points: an SVG path, broken wherever a value is not a number. Empty
 *  when fewer than two points can be drawn — one measurement is a dot, never a line. */
export function linePath(points, x, y) {
  let d = "";
  let pen = false;
  let drawn = 0;
  for (const p of points) {
    if (!Number.isFinite(p.ms) || !Number.isFinite(p.value)) {
      pen = false;
      continue;
    }
    d += `${pen ? "L" : "M"}${x(p.ms).toFixed(1)},${y(p.value).toFixed(1)}`;
    pen = true;
    drawn += 1;
  }
  return drawn >= 2 ? d : "";
}

/** Round values for the value labels: about `count` steps of 1, 2, 2.5 or 5 × 10ⁿ inside the domain. */
export function valueTicks(domain, count = 4) {
  if (!domain) return [];
  const raw = (domain.hi - domain.lo) / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = NICE_STEPS.map((s) => s * magnitude).find((s) => s >= raw) ?? 10 * magnitude;
  const out = [];
  for (let v = Math.ceil(domain.lo / step) * step; v <= domain.hi + 1e-9; v += step) out.push(Number(v.toFixed(6)));
  return out;
}

/** The time labels: whole local hours on the window's step (the browser's zone is the ward's). */
export function timeTicks(sinceMs, untilMs, hours) {
  const step = TICK_HOURS[hours] ?? Math.max(1, Math.round(hours / 6));
  const at = new Date(sinceMs);
  at.setMinutes(0, 0, 0);
  while (at.getTime() < sinceMs || at.getHours() % step !== 0) at.setHours(at.getHours() + 1);
  const out = [];
  for (; at.getTime() <= untilMs; at.setHours(at.getHours() + step)) out.push(at.getTime());
  return out;
}

/** The marks inside the window, with their x. */
export function markerMarks(markers, x, sinceMs, untilMs) {
  return (markers ?? []).filter((m) => m.ms >= sinceMs && m.ms <= untilMs).map((m) => ({ ...m, x: x(m.ms) }));
}

/** The index of the drawable point nearest `px` in time (the later one on a tie), or -1. */
export function nearestIndex(points, x, px) {
  let best = -1;
  let distance = Infinity;
  points.forEach((p, i) => {
    if (!Number.isFinite(p.ms) || !Number.isFinite(p.value)) return;
    const d = Math.abs(x(p.ms) - px);
    if (d <= distance) {
      best = i;
      distance = d;
    }
  });
  return best;
}

/** The mark within one pixel column of `px`, or null. */
export function markerNear(marks, px) {
  return marks.find((m) => Math.abs(m.x - px) <= 1) ?? null;
}

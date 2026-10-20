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

// The plot's margins, in pixels. The viewBox is the measured width, so a unit is a pixel.
const LABEL_PAD = 34;       // room for the value labels on the left, big chart only
const LABEL_RIGHT_PAD = 8;  // the big chart's right margin, so its last time label is not cut off
const EDGE_PAD = 2;         // the mini chart's side margins, so an edge dot is not cut off
const TOP_PAD = 6;
const BOTTOM_PAD = 6;
const AXIS_BASELINE = 4;    // the time labels' baseline above the chart's bottom edge
export const MARKER_LANE = 14;
export const AXIS_LANE = 16;
// The time-label step per window: hourly over 6 h, every 4 h over 24 h, every 12 h over 3 days.
const TICK_HOURS = { 6: 1, 24: 4, 72: 12 };
// A value label's step is 1, 2, 5 or 10 × 10ⁿ — the one NEAREST the raw step on a log scale, by d3's
// thresholds (√50, √10, √2). Rounding up to the next nice step instead could double it: systolic
// 60–220 then got only two labels, 100 and 200.
const STEP_E10 = Math.sqrt(50);
const STEP_E5 = Math.sqrt(10);
const STEP_E2 = Math.sqrt(2);
// A time label's width, estimated: 10-px digits at up to 1.12× (the --fs setting) are ≈ 6.5 px each.
const TIME_LABEL_CHAR_PX = 6.5;

/** The plot area of a `width` × `height` chart. The big chart has value labels on the left, a lane
 *  under the plot for the ▲/◆ marks, and one under that for the time labels. */
export function plotFrame(width, height, { labels = false, markers = false, axis = false } = {}) {
  const left = labels ? LABEL_PAD : EDGE_PAD;
  const right = Math.max(left + 1, width - (labels ? LABEL_RIGHT_PAD : EDGE_PAD));
  const top = TOP_PAD;
  const bottom = Math.max(top + 1, height - BOTTOM_PAD - (markers ? MARKER_LANE : 0) - (axis ? AXIS_LANE : 0));
  return { left, right, top, bottom, laneY: bottom + BOTTOM_PAD + MARKER_LANE / 2, axisY: height - AXIS_BASELINE };
}

/** Whether a window can be drawn: both ends are numbers and it does not run backwards. A window of no
 *  length is drawable (everything lands on its left edge); one with an end that is not a number is
 *  not — every x would be NaN, or, worse, every dot would pile up on the left edge. */
export function validWindow(sinceMs, untilMs) {
  return Number.isFinite(sinceMs) && Number.isFinite(untilMs) && untilMs >= sinceMs;
}

/** The centre of the pixel row (or column) a coordinate falls in. A 1-px line drawn on a whole number
 *  straddles two rows and renders as two blurred ones; drawn on the centre it is one crisp one. */
export const crisp = (v) => Math.floor(v) + 0.5;

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

/** The domain onto [bottom, top] (larger values higher). A range with no height — `valueDomain` never
 *  gives one, but a caller's own might — is drawn on the midline instead of dividing by zero. */
export function valueScale(domain, top, bottom) {
  const span = domain.hi - domain.lo;
  if (!(span > 0)) return () => (top + bottom) / 2;
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

/** The finite values' own range, `{ lo, hi }`, or null. */
export function valueExtent(values) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values ?? []) {
    if (Number.isFinite(v)) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  return lo > hi ? null : { lo, hi };
}

/** The data's resolution: the coarsest power of ten every finite value is a multiple of (to three
 *  decimals) — 1 for a pulse, 0.1 for a temperature measured to a tenth. */
export function valueResolution(values) {
  let decimals = 0;
  for (const v of values ?? []) {
    if (!Number.isFinite(v)) continue;
    while (decimals < 3 && Math.abs(Number(v.toFixed(decimals)) - v) > 1e-9) decimals += 1;
  }
  return 10 ** -decimals;
}

/** The step of the value labels: about `count` of them over the domain, at 1, 2, 5 or 10 × 10ⁿ —
 *  the nearest (d3's rule) — and never finer than the data's own `resolution`: a temperature measured
 *  to 0.1 is not labelled to 0.05. Null for no domain, or one of no height. */
export function valueTickStep(domain, count = 4, resolution = 0) {
  if (!domain || !(domain.hi > domain.lo)) return null;
  const raw = (domain.hi - domain.lo) / count;
  const power = Math.floor(Math.log10(raw));
  const error = raw / 10 ** power;
  const factor = error >= STEP_E10 ? 10 : error >= STEP_E5 ? 5 : error >= STEP_E2 ? 2 : 1;
  return Math.max(factor * 10 ** power, resolution);
}

/** Round values for the value labels, at `valueTickStep`. With `extent` — the data's own range — only
 *  those inside it: the domain's margin is the chart's, not the patient's, and a label past the data
 *  names a value nobody measured (SpO₂ 105, lactate −0.5). Clamping to a "possible" range instead
 *  would be a range the browser holds; there is none here. */
export function valueTicks(domain, count = 4, { extent = null, resolution = 0 } = {}) {
  const step = valueTickStep(domain, count, resolution);
  if (!step) return [];
  const lo = extent ? Math.max(domain.lo, extent.lo) : domain.lo;
  const hi = extent ? Math.min(domain.hi, extent.hi) : domain.hi;
  const out = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + 1e-9; v += step) out.push(Number(v.toFixed(6)));
  return out;
}

/** A value label: as many decimals as its step has, and no more ("37.5", never "37.50"). */
export function tickLabel(v, step) {
  const decimals = step > 0 ? Math.min(3, Math.max(0, -Math.floor(Math.log10(step) + 1e-9))) : 0;
  return v.toFixed(decimals);
}

/** The time labels: whole local hours on the window's step (the browser's zone is the ward's). None
 *  for a window that is not a window — `new Date(NaN).getHours()` is NaN, and the search below would
 *  never end. */
export function timeTicks(sinceMs, untilMs, hours) {
  if (!validWindow(sinceMs, untilMs)) return [];
  const step = TICK_HOURS[hours] ?? Math.max(1, Math.round(hours / 6));
  if (!Number.isFinite(step)) return [];
  const at = new Date(sinceMs);
  at.setMinutes(0, 0, 0);
  while (at.getTime() < sinceMs || at.getHours() % step !== 0) at.setHours(at.getHours() + 1);
  const out = [];
  for (; at.getTime() <= untilMs; at.setHours(at.getHours() + step)) out.push(at.getTime());
  return out;
}

/** Where a time label goes on a chart `width` wide: centred on its instant, unless that runs it past
 *  an edge — then anchored to that edge, so "dd.mm HH:MM" at 72 h is never cut off. */
export function timeLabelPlace(x, text, width) {
  const half = (String(text).length * TIME_LABEL_CHAR_PX) / 2;
  if (x + half > width) return { x: width, anchor: "end" };
  if (x - half < 0) return { x: 0, anchor: "start" };
  return { x, anchor: "middle" };
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

/** EVERY mark within one pixel column of `px`, in their order — two alert kinds can be first detected
 *  on one reading, and the readout must name both. */
export function marksNear(marks, px) {
  return (marks ?? []).filter((m) => Math.abs(m.x - px) <= 1);
}

/** The same question asked in time, for a caller that holds an instant and the chart's milliseconds
 *  per pixel (the dialog's readout, whose cursor may have been moved by the keyboard). None on a
 *  chart of no width. */
export function marksAtTime(markers, ms, msPerPx) {
  if (!(msPerPx > 0) || !Number.isFinite(ms)) return [];
  return (markers ?? []).filter((m) => Math.abs(m.ms - ms) <= msPerPx);
}

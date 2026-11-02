// src/live/screens/common/waveGeometry.js — where a wave goes on its row, and what the row says
// about its own data. Pure: no React, no DOM, no clock but the instants it is handed. Tested
// without a canvas (waveGeometry.test.js).
//
// NOTHING HERE MEASURES ANYTHING (spec §5.4). Samples become pixels; a row is live, "sinyal yok",
// stalled or cleared; and that is all — no rate, beat, amplitude or threshold on a sample.
//
// Time is the MONITOR's clock (`t`, device seconds). `headAt` is where that clock stands now: the
// store's last sample (the newest block's end plus how long ago the worker received it) carried
// forward on this browser's monotonic clock, `nextAnchor` smoothing the poll-to-poll jitter. A row
// draws WINDOW_S of it, ending DELAY_S behind the head; when the data ends before that, the row
// stops there (frozen), greys after GREY_AFTER_S more, and is cleared CLEAR_AFTER_S after the data's
// end. Gaps and "no signal" blocks break the line; nothing is ever drawn where there is no sample.
import { WAVE_BLOCK_S } from "../../data/waveStore.js";

export const DELAY_S = 2.0;
export const WINDOW_S = 6.0;
export const GREY_AFTER_S = 1.5;
export const CLEAR_AFTER_S = 10.0;
export const ECG_SPAN = 1200;                       // counts, either way: fixed, never autoscaled
// Every catalogued pressure wave (0x0301 "ART", 0x0e01 "P1"): mmHg = sample / 40, checked against
// the screen on BED07 and BED08 (docs/INFINITY-DALGA-FORMU.md, "ART ölçeği"; the lead's note of 27.10).
export const COUNTS_PER_MMHG = 40;
export const PRESSURE_MAX = 200;
export const PRESSURE_MAX_WIDE = 250;
export const PRESSURE_LINES = Object.freeze([50, 100, 150]);
export const AUTOSCALE_S = 10.0;
// The smallest span a relative row is stretched to, in counts: a near-flat signal stays near-flat
// instead of being blown up into something that looks like a wave. A display constant, not a
// measurement; to be checked against the bedside screen in the ward check (spec §9, V5).
export const MIN_SPAN = Object.freeze({ pleth: 200, resp: 200 });
export const HEAD_JUMP_S = 1.0;
export const HEAD_SMOOTHING = 0.25;
export const RANGE_TAU_S = 2.0;
const GAP_TOLERANCE = 0.5;     // of one sample interval: a block further off its predecessor's end is a gap
const PAD = 2;                 // px kept clear at a row's top and bottom

/** The head estimate after a new store sample: the sample itself the first time or after a jump
 *  of more than HEAD_JUMP_S, else the old estimate carried forward and moved HEAD_SMOOTHING of the
 *  way to the sample — so the trace scrolls smoothly between polls. */
export function nextAnchor(previous, sample) {
  if (!sample) return previous ?? null;
  if (!previous) return sample;
  const predicted = previous.deviceS + (sample.perfMs - previous.perfMs) / 1000;
  const error = sample.deviceS - predicted;
  if (!Number.isFinite(error) || Math.abs(error) > HEAD_JUMP_S) return sample;
  return { deviceS: predicted + error * HEAD_SMOOTHING, perfMs: sample.perfMs };
}

/** Where the monitor's clock stands at this browser's `perfMs`, or null with no anchor. */
export function headAt(anchor, perfMs) {
  if (!anchor || !Number.isFinite(perfMs)) return null;
  return anchor.deviceS + (perfMs - anchor.perfMs) / 1000;
}

const byNumber = (a, b) => Number(a) - Number(b);

// The row groups, in screen order, and how many rows each may have (spec §3.3, §4; amended
// 2026-10-27 after BED08). Within a group the ids go in ascending order, which IS the preference
// order: ECG 0x0102, 0x0103, 0x0104, 0x0122, 0x0124; pressure 0x0301, 0x0e01.
export const ROW_GROUPS = Object.freeze([["ecg", 2], ["pressure", 2], ["pleth", 1], ["resp", 1]]);

/** The rows a monitor gets. A wave carrying samples somewhere in what is held is "live"; each group
 *  shows its live waves, up to its limit. A group the monitor transmits with NO live wave still gets
 *  one row, its first wave, which then says "sinyal yok": an absent ECG must read as no signal,
 *  never as nothing (spec §5.2). The live ECG channel is not fixed by id — 0x0103 on BED07, 0x0102
 *  on BED08 — so the ECG rows are chosen by liveness and never named by lead. A wave the
 *  catalogue does not name gets no row. */
export function rowsOf(blocks, catalogue) {
  const kindOf = (id) => catalogue?.[id]?.kind;
  const present = Object.keys(blocks ?? {}).filter((id) => blocks[id]?.length > 0 && kindOf(id)).sort(byNumber);
  const live = (id) => blocks[id].some((b) => b.samples !== null);
  return ROW_GROUPS.flatMap(([kind, max]) => {
    const sent = present.filter((id) => kindOf(id) === kind);
    const alive = sent.filter(live);
    return (alive.length > 0 ? alive.slice(0, max) : sent.slice(0, 1)).map((id) => ({ id, kind }));
  });
}

/** The last block that starts at or before device time `s`, or null. */
export function blockAt(blocks, s) {
  let lo = 0;
  let hi = blocks.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (blocks[mid].t <= s) lo = mid + 1;
    else hi = mid;
  }
  return lo === 0 ? null : blocks[lo - 1];
}

/** What a row says of its data at head `headS`: waiting (nothing yet), live, nosignal (the block
 *  at its right edge is "no signal"), stalled (the data ended more than GREY_AFTER_S before the
 *  render time) or cleared (no data for CLEAR_AFTER_S). `silentS`: how long since the data's end,
 *  in device seconds — the N of "akış durdu · N sn". `endS`: that end. */
export function rowState(blocks, headS) {
  if (!blocks?.length || !Number.isFinite(headS)) return { state: "waiting", silentS: null, endS: null };
  const endS = blocks[blocks.length - 1].t + WAVE_BLOCK_S;
  const silentS = Math.max(0, headS - endS);
  if (silentS >= CLEAR_AFTER_S) return { state: "cleared", silentS, endS };
  if (silentS - DELAY_S > GREY_AFTER_S) return { state: "stalled", silentS, endS };
  const edge = blockAt(blocks, Math.min(headS - DELAY_S, endS - 1e-6));
  if (edge && edge.samples === null) return { state: "nosignal", silentS, endS };
  return { state: "live", silentS, endS };
}

/** ECG: fixed gain, ±ECG_SPAN counts over the row's height; beyond it, the edge and a clip mark. */
export function ecgY(height) {
  const mid = height / 2;
  const half = Math.max(0, height / 2 - PAD);
  return (v) => {
    if (v > ECG_SPAN) return { y: mid - half, clip: "top" };
    if (v < -ECG_SPAN) return { y: mid + half, clip: "bottom" };
    return { y: mid - (v / ECG_SPAN) * half, clip: null };
  };
}

/** A pressure row: 0–`max` mmHg bottom to top, a sample being mmHg × COUNTS_PER_MMHG. */
export function pressureY(height, max) {
  const usable = Math.max(0, height - 2 * PAD);
  return (v) => {
    const mmHg = v / COUNTS_PER_MMHG;
    if (mmHg > max) return { y: PAD, clip: "top" };
    if (mmHg < 0) return { y: height - PAD, clip: "bottom" };
    return { y: height - PAD - (mmHg / max) * usable, clip: null };
  };
}

/** A pressure row's faint lines (50, 100, 150 mmHg), as y positions. */
export function pressureGrid(height, max) {
  const y = pressureY(height, max);
  return PRESSURE_LINES.map((mmHg) => y(mmHg * COUNTS_PER_MMHG).y);
}

/** The pressure axis: PRESSURE_MAX, or PRESSURE_MAX_WIDE while a sample in the window is above it. */
export function pressureMax(blocks, leftS, rightS) {
  for (const b of blocks) {
    if (b.samples === null || b.t + WAVE_BLOCK_S < leftS || b.t > rightS) continue;
    for (const v of b.samples) if (v > PRESSURE_MAX * COUNTS_PER_MMHG) return PRESSURE_MAX_WIDE;
  }
  return PRESSURE_MAX;
}

/** A relative row's target range: the last AUTOSCALE_S of samples, never narrower than `minSpan`,
 *  with a 10 % margin. null when there is no sample. */
export function autoscale(blocks, rightS, minSpan) {
  let lo = Infinity;
  let hi = -Infinity;
  const from = rightS - AUTOSCALE_S;
  for (const b of blocks) {
    if (b.samples === null || b.t + WAVE_BLOCK_S < from || b.t > rightS) continue;
    for (const v of b.samples) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  if (lo === Infinity) return null;
  const span = Math.max(hi - lo, minSpan);
  const mid = (hi + lo) / 2;
  return { lo: mid - span * 0.55, hi: mid + span * 0.55 };
}

/** The range a relative row draws with: it widens at once to the target, and narrows towards it
 *  with time constant RANGE_TAU_S — a slow autoscale that never cuts the trace off. */
export function easeRange(previous, target, dtS) {
  if (!target) return previous ?? null;
  if (!previous) return target;
  const k = 1 - Math.exp(-Math.max(0, dtS) / RANGE_TAU_S);
  return {
    lo: Math.min(target.lo, previous.lo + (target.lo - previous.lo) * k),
    hi: Math.max(target.hi, previous.hi + (target.hi - previous.hi) * k),
  };
}

/** A relative row: `range` bottom to top, clamped to the row. */
export function rangeY(height, range) {
  const usable = Math.max(0, height - 2 * PAD);
  const span = range.hi - range.lo || 1;
  return (v) => {
    const f = Math.min(1, Math.max(0, (v - range.lo) / span));
    return { y: height - PAD - f * usable, clip: null };
  };
}

/** The polylines of one wave between device times `leftS` and `rightS` on a `width`-px row, as
 *  flat [x0, y0, x1, y1, …] arrays: a new one after a gap or a "no signal" block, nothing drawn
 *  across either. `clips`: [x, "top" | "bottom"] where the trace leaves the row (once per run). */
export function tracePaths(blocks, { leftS, rightS, width, y }) {
  const paths = [];
  const clips = [];
  const scale = rightS > leftS ? width / (rightS - leftS) : 0;
  let current = null;
  let lastEnd = null;
  let clipping = null;           // the edge the trace is beyond now, or null
  for (const b of blocks) {
    if (b.t > rightS) break;
    const end = b.t + WAVE_BLOCK_S;
    if (end < leftS || b.samples === null) {
      current = null;
      lastEnd = end;
      clipping = null;
      continue;
    }
    const step = 1 / b.rate;
    if (current === null || lastEnd === null || Math.abs(b.t - lastEnd) > step * GAP_TOLERANCE) {
      current = [];
      paths.push(current);
      clipping = null;
    }
    for (let i = 0; i < b.samples.length; i += 1) {
      const s = b.t + i * step;
      if (s < leftS || s > rightS) continue;
      const x = (s - leftS) * scale;
      const p = y(b.samples[i]);
      current.push(x, p.y);
      if (p.clip && p.clip !== clipping) clips.push([x, p.clip]);
      clipping = p.clip;
    }
    lastEnd = end;
  }
  return { paths: paths.filter((path) => path.length >= 4), clips };
}

/** Everything one row draws at head `headS` on a `size` ({width, height}) canvas: its state, its
 *  paths, clip marks and grid lines, and the range a relative row used (fed back next frame). */
export function rowView(blocks, kind, headS, size, previousRange = null, dtS = 0) {
  const state = rowState(blocks, headS);
  const none = { ...state, paths: [], clips: [], grid: [], range: previousRange };
  if (state.state === "waiting" || state.state === "cleared") return none;
  const rightS = Math.min(headS - DELAY_S, state.endS);
  const leftS = rightS - WINDOW_S;
  let y;
  let grid = [];
  let range = previousRange;
  if (kind === "ecg") {
    y = ecgY(size.height);
  } else if (kind === "pressure") {
    const max = pressureMax(blocks, leftS, rightS);
    y = pressureY(size.height, max);
    grid = pressureGrid(size.height, max);
  } else {
    range = easeRange(previousRange, autoscale(blocks, rightS, MIN_SPAN[kind] ?? MIN_SPAN.pleth), dtS);
    if (!range) return { ...none, range };
    y = rangeY(size.height, range);
  }
  const { paths, clips } = tracePaths(blocks, { leftS, rightS, width: size.width, y });
  return { ...state, paths, clips, grid, range };
}

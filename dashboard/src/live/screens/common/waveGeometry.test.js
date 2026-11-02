// Where a wave goes on its row — without a canvas. Synthetic blocks only (waves.testutil.js).
import { describe, it, expect } from "vitest";
import {
  CLEAR_AFTER_S, DELAY_S, MIN_SPAN, PRESSURE_MAX, PRESSURE_MAX_WIDE, WINDOW_S, autoscale, easeRange, ecgY,
  headAt, nextAnchor, pressureGrid, pressureMax, pressureY, rowState, rowView, rowsOf, tracePaths,
} from "./waveGeometry.js";
import { CATALOGUE, T_END, bed4, bed8, run, wblock } from "../../data/waves.testutil.js";

const byId = (blocks) => blocks.reduce((out, b) => {
  (out[String(b.id)] ??= []).push(b);
  return out;
}, {});
const ECG = run(259);                          // 8 s of ECG ending at T_END (1008)
const ROW = { width: 600, height: 60 };
const ysOf = (path) => path.filter((_, i) => i % 2 === 1);
const farthest = (ys, from) => Math.max(...ys.map((y) => Math.abs(y - from)));
// 8 s of ECG from device time 1000 whose every sample is its own index in the run less 800 (−800 …
// 799 counts, inside the fixed ±1200): a point's height on a 60 px row says when it was sampled.
const CLOCK = run(259).map((b, j) => ({ ...b, samples: b.samples.map((_, i) => j * 40 + i - 800) }));
const sampledAt = (y) => 1000 + (((30 - y) * 1200) / 28 + 800) / 200;

describe("the head: where the monitor's clock stands", () => {
  it("takes the first sample, then smooths small corrections and takes jumps whole", () => {
    expect(nextAnchor(null, { deviceS: 100, perfMs: 0 })).toEqual({ deviceS: 100, perfMs: 0 });
    const smoothed = nextAnchor({ deviceS: 100, perfMs: 0 }, { deviceS: 101.1, perfMs: 1000 });
    expect(smoothed.deviceS).toBeCloseTo(101.025, 9);       // predicted 101, a quarter of the way to 101.1
    expect(nextAnchor({ deviceS: 100, perfMs: 0 }, { deviceS: 105, perfMs: 1000 })).toEqual({ deviceS: 105, perfMs: 1000 });
    expect(nextAnchor({ deviceS: 100, perfMs: 0 }, null)).toEqual({ deviceS: 100, perfMs: 0 });
  });

  it("moves on with this browser's monotonic clock", () => {
    expect(headAt({ deviceS: 100, perfMs: 1000 }, 3500)).toBe(102.5);
    expect(headAt(null, 3500)).toBeNull();
  });
});

describe("which rows a monitor gets", () => {
  it("ECG, pressure, pleth, resp — only for waves the monitor transmits", () => {
    expect(rowsOf(byId(bed4()), CATALOGUE)).toEqual([
      { id: "259", kind: "ecg" }, { id: "769", kind: "pressure" }, { id: "6422", kind: "pleth" }, { id: "513", kind: "resp" }]);
    expect(rowsOf(byId([...run(259), ...run(513)]), CATALOGUE).map((r) => r.kind)).toEqual(["ecg", "resp"]);
  });

  it("picks the ECG channel that carries samples, whichever id it is (BED08: 0x0102, not 0x0103)", () => {
    expect(rowsOf(byId(bed8()), CATALOGUE)).toEqual([{ id: "258", kind: "ecg" }, { id: "3585", kind: "pressure" }]);
  });

  it("shows at most two live ECG channels, the first in id order", () => {
    const blocks = byId([...run(290), ...run(260), ...run(259), ...run(258, { samples: null })]);
    expect(rowsOf(blocks, CATALOGUE).map((r) => r.id)).toEqual(["259", "260"]);
  });

  it("gives a monitor whose ECG channels all say 'no signal' one ECG row — never none", () => {
    const blocks = byId([...run(259, { samples: null }), ...run(258, { samples: null })]);
    expect(rowsOf(blocks, CATALOGUE)).toEqual([{ id: "258", kind: "ecg" }]);
  });

  it("shows both pressure waves when both are live, ART first", () => {
    const blocks = byId([...run(3585, { samples: 3600 }), ...run(769, { samples: 4000 })]);
    expect(rowsOf(blocks, CATALOGUE).map((r) => r.id)).toEqual(["769", "3585"]);
  });

  it("gives a wave the catalogue does not name no row", () => {
    const blocks = { ...byId(run(259)), 4242: run(259).map((b) => ({ ...b, id: 4242 })) };
    expect(rowsOf(blocks, CATALOGUE).map((r) => r.id)).toEqual(["259"]);
  });
});

describe("what a row says about its data", () => {
  it("is live while the data runs ahead of the render time, even frozen at its end", () => {
    expect(rowState(ECG, T_END + 0.2).state).toBe("live");
    expect(rowState(ECG, T_END + DELAY_S + 1.4).state).toBe("live");   // frozen, not yet grey
  });

  it("is stalled 1.5 s after the render time passes the data's end, and says how long", () => {
    const stalled = rowState(ECG, T_END + DELAY_S + 1.6);
    expect(stalled.state).toBe("stalled");
    expect(Math.floor(stalled.silentS)).toBe(3);
  });

  it("is cleared 10 s after the data's end", () => {
    expect(rowState(ECG, T_END + CLEAR_AFTER_S).state).toBe("cleared");
  });

  it("says 'no signal' when the block at its right edge is a no-signal block", () => {
    expect(rowState(run(259, { samples: null }), T_END + 0.2).state).toBe("nosignal");
  });

  it("is waiting with no block or no head", () => {
    expect(rowState([], 1000).state).toBe("waiting");
    expect(rowState(ECG, null).state).toBe("waiting");
  });

  it("greys 3.5 s and clears 10 s after the data's end, on the monitor's clock (R6, in literals)", () => {
    expect(rowState(ECG, T_END + 3.4).state).toBe("live");
    expect(rowState(ECG, T_END + 3.6).state).toBe("stalled");
    const late = rowState(ECG, T_END + 9.9);
    expect(late.state).toBe("stalled");
    expect(Math.floor(late.silentS)).toBe(9);                          // "akış durdu · 9 sn"
    expect(rowView(ECG, "ecg", T_END + 9.9, ROW).paths).toHaveLength(1);   // still drawn, frozen
    expect(rowState(ECG, T_END + 10).state).toBe("cleared");
    expect(rowView(ECG, "ecg", T_END + 10, ROW).paths).toEqual([]);
  });

  it("reads the block under the render time, not the newest: a no-signal tail says so only once on screen", () => {
    const tail = ECG.map((b) => (b.t >= 1007 ? { ...b, samples: null } : b));
    expect(rowState(tail, T_END + 0.2).state).toBe("live");           // render time 1006.2: live data
    expect(rowState(tail, T_END + 1.5).state).toBe("nosignal");       // render time 1007.5: the tail
    const [path, ...more] = rowView(tail, "ecg", T_END + 1.5, ROW).paths;
    expect(more).toEqual([]);
    expect(path[path.length - 2]).toBeLessThanOrEqual(550 + 1e-6);    // 1007.0 is x 550: nothing after it
  });
});

describe("the trace", () => {
  const ecg = (blocks) => tracePaths(blocks, { leftS: 1000.2, rightS: 1006.2, width: 600, y: ecgY(60) });

  it("spans the window: the window's first sample at x 0, its last at the right edge", () => {
    const { paths } = ecg(ECG);
    expect(paths).toHaveLength(1);
    expect(paths[0][0]).toBeCloseTo(0, 6);
    expect(paths[0][paths[0].length - 2]).toBeGreaterThan(599);
    expect(paths[0][paths[0].length - 2]).toBeLessThanOrEqual(600 + 1e-6);
    expect(paths[0].length / 2).toBeGreaterThanOrEqual(1199);           // 6 s at 200 Hz, no more
    expect(paths[0].length / 2).toBeLessThanOrEqual(1201);
  });

  it("breaks at a missing block and at a no-signal block, and draws nothing across either", () => {
    expect(ecg(ECG.filter((b) => b.t !== 1003))).toMatchObject({ paths: [expect.any(Array), expect.any(Array)] });
    const holed = ecg(ECG.map((b) => (b.t === 1003 ? { ...b, samples: null } : b))).paths;
    expect(holed).toHaveLength(2);
    const xs = holed.flatMap((p) => p.filter((_, i) => i % 2 === 0));
    expect(xs.some((x) => x > 280 + 1e-6 && x < 300 - 1e-6)).toBe(false);   // 1003.0–1003.2 is x 280–300
  });

  it("holds ECG at a fixed gain and marks where it leaves the row, once per run", () => {
    const y = ecgY(60);                                                // literals: ±1200 counts fill a 60 px row
    expect(y(1200)).toEqual({ y: 2, clip: null });
    expect(y(0)).toEqual({ y: 30, clip: null });
    expect(y(-1200)).toEqual({ y: 58, clip: null });
    expect(y(1201)).toEqual({ y: 2, clip: "top" });
    expect(y(-1201)).toEqual({ y: 58, clip: "bottom" });
    const clipped = tracePaths([wblock(259, 1000, (i) => (i < 3 ? 1500 : i < 6 ? -1500 : 0))],
      { leftS: 1000, rightS: 1000.2, width: 200, y });
    expect(clipped.clips.map((c) => c[1])).toEqual(["top", "bottom"]);
  });

  it("draws an ECG row at that gain: 600 counts is y 16 on 60 px", () => {
    const ys = rowView(run(259, { samples: 600 }), "ecg", T_END + 0.2, ROW).paths.flatMap(ysOf);
    expect(ys.length).toBeGreaterThanOrEqual(1199);
    expect(farthest(ys, 16)).toBeLessThan(1e-9);
  });

  it("never autoscales ECG: a ±10-count trace stays within a pixel of the midline", () => {
    const ys = rowView(run(259, { samples: (i) => (i % 2 === 0 ? 10 : -10) }), "ecg", T_END + 0.2, ROW)
      .paths.flatMap(ysOf);
    expect(ys.length).toBeGreaterThanOrEqual(1199);
    expect(farthest(ys, 30)).toBeLessThan(1);
  });

  it("draws the 6 s ending 2 s behind the head, at 100 px a second, never the newest samples", () => {
    const view = rowView(CLOCK, "ecg", T_END + 0.2, ROW);              // head 1008.2: render time 1006.2
    expect(view.paths).toHaveLength(1);
    const [path] = view.paths;
    const at = (k) => ({ x: path[2 * k], t: sampledAt(path[2 * k + 1]) });
    const first = at(0);
    const last = at(path.length / 2 - 1);
    expect(first.x).toBeCloseTo(0, 6);
    expect(first.t).toBeCloseTo(1000.2, 6);
    expect(last.x).toBeGreaterThan(599);
    expect(last.x).toBeLessThanOrEqual(600 + 1e-6);
    expect(last.t).toBeGreaterThan(1006.2 - 0.0051);                    // within one sample of 1006.2
    expect(last.t).toBeLessThanOrEqual(1006.2 + 1e-6);
    let off = 0;
    for (let k = 0; k < path.length / 2; k += 1) off = Math.max(off, Math.abs(at(k).x - (at(k).t - 1000.2) * 100));
    expect(off).toBeLessThan(1e-6);
  });

  it("widens a pressure row to 250 mmHg while a sample above 200 is on screen, and back after", () => {
    const spiked = run(769, { samples: 4000 })
      .map((b) => (b.t === 1001 ? { ...b, samples: b.samples.map(() => 8400) } : b));   // 210 mmHg at 1001.0
    const wide = rowView(spiked, "pressure", T_END + 0.2, { width: 600, height: 100 });  // 1000.2–1006.2
    expect(wide.grid).toHaveLength(3);
    [78.8, 59.6, 40.4].forEach((y, k) => expect(wide.grid[k]).toBeCloseTo(y, 9));   // 50, 100, 150 of 250
    const ys = wide.paths.flatMap(ysOf);
    expect(ys[0]).toBeCloseTo(59.6, 9);                                // 100 mmHg
    expect(Math.min(...ys)).toBeCloseTo(17.36, 9);                     // 210 mmHg, on the row
    expect(wide.clips).toEqual([]);
    const after = rowView(spiked, "pressure", T_END + 3, { width: 600, height: 100 });  // frozen, 1002–1008
    expect(after.state).toBe("live");
    expect(after.grid).toEqual([74, 50, 26]);
  });

  it("draws any pressure wave on 0–200 mmHg (sample / 40), widening to 250 only while it is needed", () => {
    expect(pressureY(100, PRESSURE_MAX)(4000).y).toBe(50);              // 100 mmHg, half way up
    expect(pressureGrid(100, PRESSURE_MAX)).toEqual([74, 50, 26]);      // 50, 100, 150 mmHg
    expect(pressureY(100, PRESSURE_MAX)(-40).clip).toBe("bottom");
    const high = [wblock(769, 1000, 8400)];                             // 210 mmHg
    expect(pressureMax(high, 999, 1001)).toBe(PRESSURE_MAX_WIDE);
    expect(pressureMax(high, 1001, 1007)).toBe(PRESSURE_MAX);
    const p1 = rowView(run(3585, { samples: 3600 }), "pressure", T_END + 0.2, { width: 600, height: 100 });
    expect(p1.grid).toEqual([74, 50, 26]);
    expect(p1.paths[0][1]).toBeCloseTo(98 - 0.45 * 96, 6);             // 90 mmHg
  });

  it("scales pleth and resp to their own last 10 s, never narrower than the minimum span", () => {
    const flat = autoscale([wblock(6422, 1000, 1000)], 1000.2, MIN_SPAN.pleth);
    expect(flat.lo).toBeCloseTo(890, 9);
    expect(flat.hi).toBeCloseTo(1110, 9);
    expect(autoscale([wblock(6422, 1000, null)], 1000.2, 200)).toBeNull();
    const eased = easeRange({ lo: 0, hi: 100 }, { lo: 20, hi: 80 }, 2);
    expect(eased.lo).toBeCloseTo(20 * (1 - Math.exp(-1)), 9);           // narrows slowly
    expect(easeRange({ lo: 0, hi: 100 }, { lo: -50, hi: 150 }, 0.016)).toEqual({ lo: -50, hi: 150 });  // widens at once
  });

  it("stops at the data's end when the render time has passed it (frozen), draws nothing once cleared", () => {
    const frozen = rowView(ECG, "ecg", T_END + 3, ROW);
    const last = frozen.paths[0][frozen.paths[0].length - 2];
    expect(last).toBeCloseTo(600 * (WINDOW_S - 0.005) / WINDOW_S, 6);   // the last sample, 5 ms before the end
    expect(rowView(ECG, "ecg", T_END + CLEAR_AFTER_S, ROW).paths).toEqual([]);
  });
});

describe("pleth and resp: relative rows on a slow autoscale", () => {
  it("keeps a near-flat trace near the middle: the 200-count minimum span holds inside a row (R13)", () => {
    for (const [id, kind] of [[6422, "pleth"], [513, "resp"]]) {
      const view = rowView(run(id, { samples: (i) => 1000 + (i % 5) - 2 }), kind, T_END + 0.2, ROW);
      expect(view.range.lo).toBeCloseTo(890, 9);
      expect(view.range.hi).toBeCloseTo(1110, 9);
      const ys = view.paths.flatMap(ysOf);
      expect(ys.length).toBeGreaterThanOrEqual(299);                   // 6 s at 50 Hz, at least
      expect(farthest(ys, 30)).toBeLessThan(1);
    }
  });

  it("puts a larger sample higher on the row", () => {
    const rising = run(6422).map((b, j) => ({ ...b, samples: b.samples.map((_, i) => j * 20 + i) }));  // 0 … 799
    const view = rowView(rising, "pleth", T_END + 0.2, ROW);
    expect(view.paths).toHaveLength(1);
    const ys = ysOf(view.paths[0]);
    expect(ys.length).toBeGreaterThanOrEqual(599);
    expect(ys.every((y, k) => k === 0 || y < ys[k - 1])).toBe(true);
  });

  it("scales to the last 10 s before the render time only, and narrows to it slowly", () => {
    const blocks = [wblock(6422, 990, 50000), wblock(6422, 997, 1400), ...run(6422, { samples: 1000 })];
    const view = rowView(blocks, "pleth", T_END + 0.2, ROW);           // render time 1006.2: from 996.2
    expect(view.range.lo).toBeCloseTo(980, 9);                         // 1000 … 1400 (997.0), not 50000 (990.0)
    expect(view.range.hi).toBeCloseTo(1420, 9);
    const eased = rowView(blocks, "pleth", T_END + 0.2, ROW, { lo: 0, hi: 2000 }, 2).range;
    expect(eased.lo).toBeCloseTo(980 * (1 - Math.exp(-1)), 9);
    expect(eased.hi).toBeCloseTo(2000 - 580 * (1 - Math.exp(-1)), 9);
  });
});

// Where a wave goes on its row — without a canvas. Synthetic blocks only (waves.testutil.js).
import { describe, it, expect } from "vitest";
import {
  CLEAR_AFTER_S, DELAY_S, ECG_SPAN, MIN_SPAN, PRESSURE_MAX, PRESSURE_MAX_WIDE, WINDOW_S, autoscale, easeRange, ecgY,
  headAt, nextAnchor, pressureGrid, pressureMax, pressureY, rowState, rowView, rowsOf, tracePaths,
} from "./waveGeometry.js";
import { CATALOGUE, T_END, bed4, bed8, run, wblock } from "../../data/waves.testutil.js";

const byId = (blocks) => blocks.reduce((out, b) => {
  (out[String(b.id)] ??= []).push(b);
  return out;
}, {});
const ECG = run(259);                          // 8 s of ECG ending at T_END (1008)
const ROW = { width: 600, height: 60 };

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
    const y = ecgY(60);
    expect(y(ECG_SPAN)).toEqual({ y: 2, clip: null });                // full scale is the row's edge: the gain is pinned
    expect(y(ECG_SPAN + 1)).toEqual({ y: 2, clip: "top" });
    expect(y(-ECG_SPAN - 1)).toEqual({ y: 58, clip: "bottom" });
    const clipped = tracePaths([wblock(259, 1000, (i) => (i < 3 ? 1500 : i < 6 ? -1500 : 0))],
      { leftS: 1000, rightS: 1000.2, width: 200, y });
    expect(clipped.clips.map((c) => c[1])).toEqual(["top", "bottom"]);
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

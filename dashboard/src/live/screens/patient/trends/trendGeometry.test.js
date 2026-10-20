// The trend charts' geometry, without React: every number below is worked out by hand in the
// comment beside it, so a change to the arithmetic shows up as a change to a number someone wrote.
import { describe, it, expect } from "vitest";
import {
  bandRects, crisp, indexAtTime, linePath, markerMarks, marksAtTime, nearestIndex, ownNormalRect, parseMarkers,
  parsePoints, plotFrame, tickLabel, timeLabelPlace, timeScale, timeTicks, validWindow, valueDomain, valueExtent,
  valueResolution, valueScale, valueTickStep, valueTicks,
} from "./trendGeometry.js";
import { BANDS } from "./trends.testutil.js";

const same = (v) => v;
const p = (ms, value) => ({ ms, value });

describe("the frame and the scales", () => {
  it("leaves the mini chart its whole width, and the big one room for labels, marks and times", () => {
    expect(plotFrame(320, 46)).toEqual({ left: 2, right: 318, top: 6, bottom: 40, laneY: 53, axisY: 42 });
    // 280 − 6 − 14 (marks) − 16 (times) = 244; the marks' lane centres at 244 + 6 + 7 = 257.
    expect(plotFrame(640, 280, { labels: true, markers: true, axis: true }))
      .toEqual({ left: 34, right: 632, top: 6, bottom: 244, laneY: 257, axisY: 276 });
  });

  it("maps the window's ends onto the plot's, and a window of no length onto its left edge", () => {
    expect(timeScale(0, 100, 10, 110)(50)).toBe(60);
    expect(timeScale(5, 5, 10, 110)(5)).toBe(10);
  });

  it("spans the data plus 15 % either side, and never a range of its own", () => {
    expect(valueDomain([60, 80])).toEqual({ lo: 57, hi: 83 });
    expect(valueDomain([84])).toEqual({ lo: 79.8, hi: 88.2 });          // ±5 % of one value
    expect(valueDomain([0])).toEqual({ lo: -1, hi: 1 });                // at least ±1
    expect(valueDomain([Number.NaN, null, undefined])).toBeNull();
    expect(valueDomain([])).toBeNull();
  });

  it("puts larger values higher", () => {
    const y = valueScale({ lo: 0, hi: 100 }, 0, 200);
    expect([y(0), y(50), y(100)]).toEqual([200, 100, 0]);
  });

  it("puts a range of no height on the plot's midline instead of dividing by it", () => {
    expect(valueScale({ lo: 5, hi: 5 }, 0, 20)(5)).toBe(10);
    expect(valueScale({ lo: 0, hi: Number.NaN }, 0, 20)(3)).toBe(10);
    expect(valueScale({ lo: 9, hi: 1 }, 0, 20)(3)).toBe(10);
  });

  it("places a time outside the window by the same scale — past the plot's edge, never clamped onto it", () => {
    const x = timeScale(0, 100, 10, 110);
    expect([x(-50), x(150)]).toEqual([-40, 160]);
  });

  it("calls a window drawable only when both ends are numbers and it does not run backwards", () => {
    expect(validWindow(0, 100)).toBe(true);
    expect(validWindow(5, 5)).toBe(true);
    expect(validWindow(100, 0)).toBe(false);
    expect(validWindow(Number.NaN, 100)).toBe(false);
    expect(validWindow(0, Number.NaN)).toBe(false);
    expect(validWindow(0, Infinity)).toBe(false);
    expect(validWindow(undefined, 100)).toBe(false);
  });

  it("snaps a 1-px line to the centre of the pixel row it falls in, so it is not smeared over two", () => {
    expect([crisp(9.92), crisp(19.05), crisp(10.5), crisp(10)]).toEqual([9.5, 19.5, 10.5, 10.5]);
  });
});

describe("the bands", () => {
  // Heart rate on 30–140, one pixel a beat, 140 at the top: y(v) = 140 − v (exact in binary).
  const domain = { lo: 30, hi: 140 };
  const y = (v) => 140 - v;

  it("draws each row the server scores 1 or more, clipped to the domain, in the tone of its points", () => {
    expect(bandRects(BANDS.heart_rate, domain, y, 0, 300)).toEqual([
      { x: 0, y: 100, w: 300, h: 10, tone: "crit", points: 3 }, // ≤ 40, clipped at 30
      { x: 0, y: 90, w: 300, h: 10, tone: "mid", points: 1 }, //  40–50
      { x: 0, y: 30, w: 300, h: 20, tone: "mid", points: 1 }, //  90–110
      { x: 0, y: 10, w: 300, h: 20, tone: "mid", points: 2 }, //  110–130
      { x: 0, y: 0, w: 300, h: 10, tone: "crit", points: 3 }, //  > 130, clipped at 140
    ]);
  });

  it("tints nothing a row of 0 covers, and nothing outside the domain", () => {
    expect(bandRects(BANDS.heart_rate, { lo: 60, hi: 80 }, valueScale({ lo: 60, hi: 80 }, 0, 20), 0, 300)).toEqual([]);
    expect(bandRects(null, domain, y, 0, 300)).toEqual([]);
  });

  it("draws a row red because the SERVER scored it 3, whatever the values under it look like", () => {
    const [rect] = bandRects([{ low: null, high: null, points: 3 }], { lo: 60, hi: 80 }, valueScale({ lo: 60, hi: 80 }, 0, 20), 0, 300);
    expect(rect).toEqual({ x: 0, y: 0, w: 300, h: 20, tone: "crit", points: 3 });
  });

  it("draws the patient's charted normal where the clinician put it", () => {
    const own = (v) => 120 - v;                                        // 90–120 on 0–30 px
    expect(ownNormalRect({ low: 100, high: 115 }, { lo: 90, hi: 120 }, own, 0, 300)).toEqual({ x: 0, y: 5, w: 300, h: 15 });
    expect(ownNormalRect(null, { lo: 90, hi: 120 }, own, 0, 300)).toBeNull();
    expect(ownNormalRect({ low: 200, high: 210 }, { lo: 90, hi: 120 }, own, 0, 300)).toBeNull();
  });
});

describe("the line, the labels and the marks", () => {
  it("joins two or more measurements, never one, and breaks where a value is not a number", () => {
    expect(linePath([p(0, 10), p(50, 20)], same, same)).toBe("M0.0,10.0L50.0,20.0");
    expect(linePath([p(0, 10)], same, same)).toBe("");
    expect(linePath([p(0, 10), p(10, Number.NaN), p(20, 30), p(30, 40)], same, same)).toBe("M0.0,10.0M20.0,30.0L30.0,40.0");
  });

  it("labels values at round steps inside the domain: 1, 2, 5 or 10 × 10ⁿ, the nearest (d3's rule)", () => {
    const ticksOf = (domain) => valueTicks(domain).ticks;
    expect(ticksOf({ lo: 0, hi: 100 })).toEqual([0, 20, 40, 60, 80, 100]);         // raw 25 → 20, not 25
    expect(ticksOf({ lo: 57, hi: 83 })).toEqual([60, 65, 70, 75, 80]);             // raw 6.5 → 5
    expect(ticksOf({ lo: 36.1, hi: 37.9 })).toEqual([36.5, 37, 37.5]);             // raw 0.45 → 0.5
    expect(valueTicks(null)).toEqual({ step: null, ticks: [] });
    expect(valueTicks({ lo: 5, hi: 5 }, 4, { extent: { lo: 5, hi: 5 } })).toEqual({ step: null, ticks: [] });   // a range of no height
    expect(valueTickStep({ lo: 0, hi: 0 })).toBeNull();
  });

  it("returns the step it labelled at with the labels, so a caller computes it once", () => {
    expect(valueTicks({ lo: 57, hi: 83 }).step).toBe(5);
    expect(valueTicks({ lo: 57, hi: 83 }).step).toBe(valueTickStep({ lo: 57, hi: 83 }));
  });

  it("labels systolic 60–220 every 50 — not only 100 and 200 — and only inside the data", () => {
    const domain = valueDomain([60, 220]);                                          // 36–244
    expect(valueTickStep(domain)).toBe(50);
    expect(valueTicks(domain).ticks).toEqual([50, 100, 150, 200]);
    expect(valueTicks(domain, 4, { extent: valueExtent([60, 220]) }).ticks).toEqual([100, 150, 200]);
  });

  it("never labels a value past the data: no SpO₂ 105, no lactate −0.5 in the chart's margin", () => {
    const spo2 = [92, 99, 100];
    expect(Math.max(...valueTicks(valueDomain(spo2), 4, { extent: valueExtent(spo2) }).ticks)).toBeLessThanOrEqual(100);
    const lactate = [0.5, 1, 4.1];
    expect(Math.min(...valueTicks(valueDomain(lactate), 4, { extent: valueExtent(lactate) }).ticks)).toBeGreaterThanOrEqual(0.5);
  });

  it("labels a single reading with its own value, written at the DATA's resolution — not at a step it fell between", () => {
    const label = (values) => {
      const { ticks, step } = valueTicks(valueDomain(values), 4, { extent: valueExtent(values), resolution: valueResolution(values) });
      return ticks.map((v) => tickLabel(v, step));
    };
    // The round steps (2, 0.5, 0.2) all fall to one side of the value: without this the chart has no number on it.
    expect(label([85])).toEqual(["85"]);
    expect(label([4.1])).toEqual(["4.1"]);
    expect(label([37.4])).toEqual(["37.4"]);
    expect(label([100])).toEqual(["100"]);                                          // SpO₂ 100: a step lands on it, and not past it
    expect(label([0])).toEqual(["0"]);                                              // lactate 0: the margin is −1…1, the label is 0
    expect(label([84, 84, 84])).toEqual(["84"]);                                    // repeated, still one value
  });

  it("labels both ends of an extent that no round step falls inside, written at the data's resolution", () => {
    // 80–90 asks for steps of 2 (raw 2.5); 82.6–83.4 holds no multiple of 2. (A range of two or more
    // measured values always holds a step: the margin makes the domain wider than the step.)
    const gap = valueTicks({ lo: 80, hi: 90 }, 4, { extent: { lo: 82.6, hi: 83.4 }, resolution: 0.1 });
    expect(gap.ticks).toEqual([82.6, 83.4]);
    expect(gap.step).toBe(0.1);
    // Where a step does fall inside, only the steps are labelled.
    expect(valueTicks({ lo: 80, hi: 90 }, 4, { extent: { lo: 81, hi: 87 }, resolution: 0.1 }).ticks).toEqual([82, 84, 86]);
  });

  it("labels no finer than the data is measured, with as many decimals as the step and no more", () => {
    const temps = [36.9, 37, 37.1];
    expect(valueResolution(temps)).toBeCloseTo(0.1);
    expect(valueResolution([84, 90])).toBe(1);
    const domain = valueDomain(temps);                                              // 36.87–37.13: raw 0.065
    expect(valueTickStep(domain)).toBeCloseTo(0.05);                                // what the range alone asks for
    expect(valueTickStep(domain, 4, valueResolution(temps))).toBeCloseTo(0.1);      // what a tenth-measured value allows
    expect(tickLabel(37, 0.1)).toBe("37.0");
    expect(tickLabel(36.5, 0.5)).toBe("36.5");
    expect(tickLabel(150, 50)).toBe("150");
  });

  it("keeps a wide range to a handful of round labels inside it (systolic 60–220 spans 36–244)", () => {
    const domain = valueDomain([60, 220]);
    const { ticks } = valueTicks(domain);
    expect(domain).toEqual({ lo: 36, hi: 244 });
    expect(ticks.length).toBeGreaterThanOrEqual(2);
    expect(ticks.length).toBeLessThanOrEqual(6);
    expect(ticks.every((v) => v >= domain.lo && v <= domain.hi && v % 10 === 0)).toBe(true);
    expect(ticks).toEqual([...ticks].sort((a, b) => a - b));
  });

  it("labels no time at all — and does not hang — for a window that is not a window", () => {
    expect(timeTicks(Number.NaN, 5, 24)).toEqual([]);
    expect(timeTicks(0, Number.NaN, 24)).toEqual([]);
    expect(timeTicks(0, Infinity, 24)).toEqual([]);
    expect(timeTicks(undefined, undefined, 24)).toEqual([]);
    expect(timeTicks(10, 5, 24)).toEqual([]);                          // until before since
    expect(timeTicks(0, 5, Number.NaN)).toEqual([]);                   // nor a step it cannot work out
  });

  it("labels time on whole local hours: every hour, every 4 hours, every 12 hours", () => {
    const since = new Date(2026, 9, 19, 3, 20).getTime();
    const hoursOf = (ticks) => ticks.map((ms) => new Date(ms).getHours());
    expect(hoursOf(timeTicks(since, since + 6 * 3_600_000, 6))).toEqual([4, 5, 6, 7, 8, 9]);
    expect(hoursOf(timeTicks(since, since + 24 * 3_600_000, 24))).toEqual([4, 8, 12, 16, 20, 0]);
    expect(hoursOf(timeTicks(since, since + 72 * 3_600_000, 72))).toEqual([12, 0, 12, 0, 12, 0]);
  });

  it("keeps the marks inside the window, with their x", () => {
    expect(markerMarks([{ ms: 10, kind: "alarm" }, { ms: 200, kind: "antibiotic" }], same, 0, 100))
      .toEqual([{ ms: 10, kind: "alarm", x: 10 }]);
  });

  it("finds the measurement nearest the pointer, the later one on a tie, none in an empty chart", () => {
    const points = [p(0, 1), p(10, 2), p(20, 3), p(25, Number.NaN)];
    expect(nearestIndex(points, same, 14)).toBe(1);
    expect(nearestIndex(points, same, 15)).toBe(2);
    expect(nearestIndex(points, same, 26)).toBe(2);                     // the NaN reading is not one
    expect(nearestIndex([], same, 5)).toBe(-1);
  });

  it("names EVERY mark within one pixel's worth of milliseconds of an instant, and never on a chart of no width", () => {
    // Two alert kinds first detected on one reading share an instant: the readout must name both.
    const marks = [{ ms: 1_000, kind: "alarm", label: "news2" }, { ms: 1_000, kind: "alarm", label: "sepsis" }];
    expect(marksAtTime(marks, 1_090, 100)).toEqual(marks);
    expect(marksAtTime(marks, 1_200, 100)).toEqual([]);
    expect(marksAtTime(marks, 1_000, 0)).toEqual([]);
  });

  it("finds a reading by its exact instant — the later one when two share it — and none when it slid out", () => {
    const points = [p(10, 1), p(20, 2), p(20, 3), p(30, Number.NaN)];
    expect(indexAtTime(points, 20)).toBe(2);
    expect(indexAtTime(points, 10)).toBe(0);
    expect(indexAtTime(points, 30)).toBe(3);                            // a missing value is still that instant
    expect(indexAtTime(points, 15)).toBe(-1);
    expect(indexAtTime([], 10)).toBe(-1);
    expect(indexAtTime(undefined, 10)).toBe(-1);
  });

  it("prefers the last DRAWABLE reading when two share an instant — not a valueless twin stamped after it", () => {
    const NaN_ = Number.NaN;
    expect(indexAtTime([p(10, 1), p(20, 2), p(20, NaN_)], 20)).toBe(1);
    expect(indexAtTime([p(20, 2), p(20, 3), p(20, NaN_)], 20)).toBe(1);   // the last of the drawable ones
    expect(indexAtTime([p(20, NaN_), p(20, 3)], 20)).toBe(1);
    expect(indexAtTime([p(20, NaN_), p(20, NaN_)], 20)).toBe(1);          // none drawable: still that instant, the later
  });

  it("places a time label centred on its instant, unless that would run it past an edge", () => {
    expect(timeLabelPlace(300, "12:00", 640)).toEqual({ x: 300, anchor: "middle" });
    expect(timeLabelPlace(630, "12:00", 640)).toEqual({ x: 640, anchor: "end" });              // 5 × 6.5 / 2 = 16.25 px
    expect(timeLabelPlace(600, "20.10 12:00", 640)).toEqual({ x: 600, anchor: "middle" });     // 72 h: 11 × 6.5 / 2 = 35.75 px
    expect(timeLabelPlace(610, "20.10 12:00", 640)).toEqual({ x: 640, anchor: "end" });
    expect(timeLabelPlace(4, "12:00", 640)).toEqual({ x: 0, anchor: "start" });
  });
});

describe("reading the endpoint's rows", () => {
  it("keeps every readable instant, a missing value as NaN, and the server's points only when whole", () => {
    expect(parsePoints([["2026-10-19T09:00:00Z", 84, 0], ["bad", 1, 0], ["2026-10-19T10:00:00Z", null, 2.5], "nope"])).toEqual([
      { ms: Date.parse("2026-10-19T09:00:00Z"), iso: "2026-10-19T09:00:00Z", value: 84, points: 0 },
      { ms: Date.parse("2026-10-19T10:00:00Z"), iso: "2026-10-19T10:00:00Z", value: Number.NaN, points: null },
    ]);
    expect(parsePoints(undefined)).toEqual([]);
  });

  it("keeps every mark with a readable instant", () => {
    expect(parseMarkers([{ ts: "2026-10-19T09:00:00Z", kind: "alarm", label: "news2" }, { ts: "x", kind: "alarm" }])).toEqual([
      { ms: Date.parse("2026-10-19T09:00:00Z"), iso: "2026-10-19T09:00:00Z", kind: "alarm", label: "news2" },
    ]);
  });
});

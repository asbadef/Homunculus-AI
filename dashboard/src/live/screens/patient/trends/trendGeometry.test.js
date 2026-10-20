// The trend charts' geometry, without React: every number below is worked out by hand in the
// comment beside it, so a change to the arithmetic shows up as a change to a number someone wrote.
import { describe, it, expect } from "vitest";
import {
  bandRects, linePath, markerMarks, markerNear, nearestIndex, ownNormalRect, parseMarkers, parsePoints,
  plotFrame, timeScale, timeTicks, valueDomain, valueScale, valueTicks,
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

  it("labels values at round steps inside the domain", () => {
    expect(valueTicks({ lo: 0, hi: 100 })).toEqual([0, 25, 50, 75, 100]);
    expect(valueTicks({ lo: 57, hi: 83 })).toEqual([60, 70, 80]);
    expect(valueTicks({ lo: 36.1, hi: 37.9 })).toEqual([36.5, 37, 37.5]);
    expect(valueTicks(null)).toEqual([]);
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

  it("names a mark only within one pixel column of the pointer", () => {
    const marks = [{ x: 10, kind: "alarm" }, { x: 20, kind: "antibiotic" }];
    expect(markerNear(marks, 10.9)).toEqual(marks[0]);
    expect(markerNear(marks, 12)).toBeNull();
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

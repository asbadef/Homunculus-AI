// What the chart draws, read off the SVG. jsdom has no layout, so the chart runs on its fallback
// width (320 small, 640 big) and every x below is worked out from `plotFrame` + `timeScale`.
import { afterEach, describe, it, expect, vi } from "vitest";
import React from "react";
import { act, fireEvent, render } from "@testing-library/react";
import { NOW } from "../../../data/board.testutil.js";
import { hhmm } from "../../../i18n/dates.js";
import { TrendChart } from "./TrendChart.jsx";
import { parseMarkers, parsePoints, plotFrame, timeScale, timeTicks } from "./trendGeometry.js";
import { BANDS, marker, point } from "./trends.testutil.js";

const SINCE = NOW - 24 * 3_600_000;
const hr = (raw, over = {}) => ({ key: "heart_rate", color: "text-v-hr", hollow: false, points: parsePoints(raw), ...over });

function draw(props) {
  const { container } = render(<TrendChart sinceMs={SINCE} untilMs={NOW} hours={24} {...props} />);
  return container.querySelector("svg");
}
const all = (svg, selector) => [...svg.querySelectorAll(selector)];

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("the trend chart", () => {
  it("draws a dot per measurement and a dashed connector between them", () => {
    const svg = draw({ series: [hr([point(120, 84, 0), point(60, 90, 0), point(30, 96, 1)])] });
    expect(all(svg, "circle").map((c) => c.dataset.value)).toEqual(["84", "90", "96"]);
    const [line] = all(svg, "path");
    expect(line.getAttribute("stroke-dasharray")).toBe("4 3");
  });

  it("draws one measurement as a dot, and no line", () => {
    const svg = draw({ series: [hr([point(60, 84, 0)])] });
    expect(all(svg, "circle")).toHaveLength(1);
    expect(all(svg, "path")).toHaveLength(0);
  });

  it("breaks the connector where a value is missing, and draws no dot for it", () => {
    const svg = draw({ series: [hr([point(120, 84, 0), point(90, null), point(60, 90, 0), point(30, 95, 1)])] });
    expect(all(svg, "path")[0].getAttribute("d").match(/M/g)).toHaveLength(2);
    expect(all(svg, "circle")).toHaveLength(3);
  });

  it("tints the rows the server scored 1–3 in the server's tone, and none it scored 0", () => {
    const svg = draw({ series: [hr([point(60, 60, 0), point(30, 100, 1)])], bands: { news2: BANDS.heart_rate } });
    // 60–100 drawn as 54–106: 50–90 scores 0 (untinted), 90–110 scores 1.
    expect(all(svg, "[data-band]").map((r) => [r.dataset.band, r.getAttribute("class")])).toEqual([["mid", "fill-band-mid"]]);
  });

  it("draws a row red because the server scored it 3 — the browser does not judge the values under it", () => {
    const svg = draw({ series: [hr([point(60, 72, 0)])], bands: { news2: [{ low: null, high: null, points: 3 }] } });
    expect(all(svg, "[data-band]").map((r) => r.getAttribute("class"))).toEqual(["fill-band-crit"]);
  });

  it("draws the patient's normal tinted and edged with dashes, so it is not told by colour alone", () => {
    const svg = draw({ series: [hr([point(60, 72, 0)])], bands: { news2: null, own_normal: { low: 70, high: 80 } } });
    const own = svg.querySelector("[data-own-normal]");
    expect(own.querySelector("rect")).toHaveClass("fill-band-n");
    expect(all(own, "line").map((l) => l.getAttribute("stroke-dasharray"))).toEqual(["2 3", "2 3"]);
  });

  it("gives a reader a summary — or, inside a card whose text already says it, nothing at all", () => {
    const named = draw({ series: [hr([point(60, 72, 0)])], label: "Nəbz: 1" });
    expect(named).toHaveAttribute("role", "img");
    expect(named).toHaveAttribute("aria-label", "Nəbz: 1");
    document.body.innerHTML = "";
    const quiet = draw({ series: [hr([point(60, 72, 0)])] });
    expect(quiet).toHaveAttribute("aria-hidden", "true");
    expect(quiet).not.toHaveAttribute("role");
  });

  it("on the big chart: time and value labels, ▲ and ◆ in their own lane, inside the window only", () => {
    const markers = parseMarkers([marker(60, "alarm"), marker(120, "antibiotic"), marker(30 * 60, "alarm")]);
    const svg = draw({ series: [hr([point(120, 84, 0), point(60, 132, 3)])], markers, big: true, height: 280 });
    expect(all(svg, "[data-marker]").map((m) => m.dataset.marker)).toEqual(["alarm", "antibiotic"]);
    expect(svg.querySelector("[data-marker='alarm']")).toHaveClass("fill-crit");
    expect(svg.querySelector("[data-marker='antibiotic']")).toHaveClass("fill-pri");
    expect(all(svg, "[data-tick='time']").map((t) => t.textContent)).toEqual(timeTicks(SINCE, NOW, 24).map(hhmm));
    expect(all(svg, "[data-tick='value']").length).toBeGreaterThan(1);
  });

  it("draws no marks and no labels on the small chart", () => {
    const svg = draw({ series: [hr([point(60, 84, 0)])], markers: parseMarkers([marker(60)]) });
    expect(all(svg, "[data-marker]")).toHaveLength(0);
    expect(all(svg, "text")).toHaveLength(0);
  });

  it("follows the mouse to the nearest measurement, and lets go when it leaves", () => {
    const onCursor = vi.fn();
    const svg = draw({ series: [hr([point(120, 84, 0), point(60, 90, 0)])], big: true, height: 280, onCursor });
    const frame = plotFrame(640, 280, { labels: true, markers: true, axis: true });
    const x = timeScale(SINCE, NOW, frame.left, frame.right);
    fireEvent.mouseMove(svg, { clientX: x(NOW - 61 * 60_000) });
    expect(onCursor).toHaveBeenLastCalledWith(1, "mouse");
    fireEvent.mouseLeave(svg);
    expect(onCursor).toHaveBeenLastCalledWith(null, "mouse");
  });

  it("draws the cursor where it is told, on the first series", () => {
    const svg = draw({ series: [hr([point(120, 84, 0), point(60, 90, 0)])], big: true, height: 280, cursor: 1 });
    const frame = plotFrame(640, 280, { labels: true, markers: true, axis: true });
    const x = timeScale(SINCE, NOW, frame.left, frame.right);
    expect(Number(svg.querySelector("[data-cursor] line").getAttribute("x1"))).toBeCloseTo(x(NOW - 60 * 60_000));
  });

  it("draws MAP's dots hollow", () => {
    const svg = draw({ series: [hr([point(60, 58)], { key: "map", color: "text-v-map", hollow: true })] });
    expect(svg.querySelector("[data-series='map'] circle")).toHaveClass("fill-card");
  });

  it("widens its range to take in the patient's normal, so a band just entered is always on the chart", () => {
    // 72 alone would span 68.4–75.6 and leave a normal of 100–115 off the chart. With it the range is
    // 72–115 ± 15 % = 65.55–121.45 on y 40 (bottom) to 6 (top): y(115) = 9.92, y(100) = 19.05.
    const svg = draw({ series: [hr([point(60, 72, 0)])], bands: { news2: null, own_normal: { low: 100, high: 115 } } });
    const own = svg.querySelector("[data-own-normal]");
    const rect = own.querySelector("rect");
    expect(Number(rect.getAttribute("y"))).toBeCloseTo(9.923, 2);
    expect(Number(rect.getAttribute("height"))).toBeCloseTo(9.123, 2);
    // The dashed edges are 1-px lines: each sits on the centre of the pixel row its edge falls in.
    expect(all(own, "line").map((l) => [l.getAttribute("y1"), l.getAttribute("y2")])).toEqual([["9.5", "9.5"], ["19.5", "19.5"]]);
  });

  it("snaps the big chart's grid lines onto the centre of a pixel row too", () => {
    const svg = draw({ series: [hr([point(120, 84, 0), point(60, 132, 3)])], big: true, height: 280 });
    const ys = all(svg, "[data-tick='value'] line").map((l) => Number(l.getAttribute("y1")));
    expect(ys.length).toBeGreaterThan(1);
    expect(ys.every((v) => v % 1 === 0.5)).toBe(true);
  });

  it("draws nothing for a window it cannot place — an end that is missing, or an end before the start", () => {
    const series = [hr([point(60, 84, 0), point(30, 90, 0)])];
    expect(draw({ series, sinceMs: Number.NaN })).toBeNull();
    expect(draw({ series, untilMs: undefined })).toBeNull();
    expect(draw({ series, sinceMs: NOW, untilMs: SINCE })).toBeNull();
    expect(draw({ series, sinceMs: Number.NaN, big: true, height: 280, label: "Nəbz" })).toBeNull();
  });

  it("places a measurement stamped after the window's end by the same scale, and drops a mark there", () => {
    const frame = plotFrame(640, 280, { labels: true, markers: true, axis: true });
    const x = timeScale(SINCE, NOW, frame.left, frame.right);
    const svg = draw({
      series: [hr([point(60, 84, 0), point(-30, 90, 0)])],            // the second is 30 minutes AFTER `until`
      markers: parseMarkers([marker(-30, "alarm")]), big: true, height: 280,
    });
    const [, late] = all(svg, "circle");
    expect(Number(late.getAttribute("cx"))).toBeCloseTo(x(NOW + 30 * 60_000));
    expect(Number(late.getAttribute("cx"))).toBeGreaterThan(frame.right);   // past the edge, never clamped onto it
    expect(all(svg, "[data-marker]")).toHaveLength(0);
  });

  it("draws two readings at one instant, and two alerts first seen on one reading, each under a key of its own", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const markers = parseMarkers([marker(60, "alarm", "news2"), marker(60, "alarm", "lactate"), marker(60, "antibiotic")]);
    const svg = draw({ series: [hr([point(60, 84, 0), point(60, 90, 1)])], markers, big: true, height: 280 });
    expect(all(svg, "circle").map((c) => c.dataset.value)).toEqual(["84", "90"]);
    expect(all(svg, "[data-marker]").map((m) => m.dataset.marker)).toEqual(["alarm", "alarm", "antibiotic"]);
    expect(error.mock.calls.flat().join(" ")).not.toMatch(/same key/);
  });
});

describe("the trend chart's width", () => {
  // jsdom has no layout: clientWidth is 0 and there is no ResizeObserver. Both are stood in for here.
  function measured(initial) {
    const state = { width: initial, notify: null, disconnect: vi.fn() };
    vi.spyOn(Element.prototype, "clientWidth", "get").mockImplementation(() => state.width);
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback) { state.notify = callback; }
      observe() {}
      disconnect() { state.disconnect(); }
    });
    return state;
  }

  it("measures the box it sits in, so a unit is a pixel, follows it as it resizes and lets go on unmount", () => {
    const box = measured(480);
    const { container, unmount } = render(<TrendChart series={[hr([point(60, 84, 0)])]} sinceMs={SINCE} untilMs={NOW} />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("viewBox", "0 0 480 46");
    const x480 = timeScale(SINCE, NOW, 2, 478);
    expect(Number(svg.querySelector("circle").getAttribute("cx"))).toBeCloseTo(x480(NOW - 60 * 60_000));
    box.width = 300;
    act(() => box.notify());
    expect(svg).toHaveAttribute("viewBox", "0 0 300 46");
    unmount();
    expect(box.disconnect).toHaveBeenCalled();
  });

  it("attaches its observer when a window it could not draw becomes one, and lets go when it stops being one", () => {
    // An answer whose since / until cannot be read draws nothing, so there is no box to measure; the
    // valid answer after it must find one.
    const box = measured(480);
    const series = [hr([point(60, 84, 0)])];
    const { container, rerender } = render(<TrendChart series={series} sinceMs={Number.NaN} untilMs={Number.NaN} />);
    expect(container.querySelector("svg")).toBeNull();
    rerender(<TrendChart series={series} sinceMs={SINCE} untilMs={NOW} />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("viewBox", "0 0 480 46");
    box.width = 300;
    act(() => box.notify());
    expect(svg).toHaveAttribute("viewBox", "0 0 300 46");
    rerender(<TrendChart series={series} sinceMs={Number.NaN} untilMs={Number.NaN} />);
    expect(box.disconnect).toHaveBeenCalled();
  });

  it("keeps its fallback width while the box has none (hidden, not laid out yet)", () => {
    measured(0);
    const { container } = render(<TrendChart series={[hr([point(60, 84, 0)])]} sinceMs={SINCE} untilMs={NOW} />);
    expect(container.querySelector("svg")).toHaveAttribute("viewBox", "0 0 320 46");
  });
});

// src/live/screens/patient/trends/TrendChart.jsx — one card's chart, small (in the card) or big (in
// the dialog). It draws what the engine sent and nothing else:
//   * the NEWS2 rows the server scored 1–3, tinted by the server's points (`news2Tone`), and the
//     patient's charted normal, tinted and edged with a dashed line (so it is not told by colour);
//   * a DOT per measurement, and between two measurements a DASHED line — an interval, never a
//     measurement (the legend says so); one measurement is a dot and no line;
//   * on the big chart, the value and time labels, and ▲ (alarm, `--crit`) and ◆ (antibiotic,
//     `--pri`) in a lane of their own under the plot, never over a band (tokens.test.js holds both).
// The series' colour is its channel's identity colour (`vitals.js`), through `currentColor`; MAP's dots
// are hollow. Every colour is a token class; none is written here.
//
// A window that is not a window (an end that is not a number, an end before the start) draws NOTHING:
// there is nowhere to put a measurement, and a chart that piles every dot on its left edge would say
// something false. The card's text is the equivalent either way.
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { FOCUS_RING } from "../../../ui/focus.js";
import {
  bandRects, crisp, linePath, markerMarks, nearestIndex, ownNormalRect, plotFrame, tickLabel, timeLabelPlace,
  timeScale, timeTicks, validWindow, valueDomain, valueExtent, valueResolution, valueScale, valueTicks,
} from "./trendGeometry.js";
import { whenText } from "./trendText.js";

const BAND_FILL = { mid: "fill-band-mid", crit: "fill-band-crit" };
const drawable = (p) => Number.isFinite(p.ms) && Number.isFinite(p.value);

// How things are drawn, in pixels (the viewBox is the measured width, so a unit is a pixel). Sizes and
// dashes only: no clinical number, and no colour, lives here.
const DOT_RADIUS = { small: 2.5, big: 3.5 };
const LINE_WIDTH = 1.5;             // a series' connector, and the ring of a hollow dot
const HAIRLINE = 1;
const CONNECTOR_DASH = "4 3";       // between two measurements: an interval, never a measurement
const OWN_NORMAL_DASH = "2 3";      // the patient's normal's edges; finer, so the two never read alike
const VALUE_LABEL_GAP = 5;          // between a value label and the plot's left edge
const VALUE_LABEL_BASELINE = 3.5;   // a value label's baseline below the gridline it names
const ALARM_HALF_WIDTH = 6;         // ▲ is 12 px wide and 10 px high
const ALARM_HALF_HEIGHT = 5;
const DIAMOND_HALF = 4;             // ◆ is an 8-px square turned 45°
const CURSOR_RADIUS = 6;
const CURSOR_LINE_OPACITY = 0.5;

/** The element's width in CSS pixels, followed as it changes; `fallback` where nothing can measure
 *  it (no ResizeObserver: jsdom, an old browser). The viewBox is that width, so one unit is one pixel
 *  and a dot stays round at any size.
 *
 *  `mounted` says whether the element exists at all: the chart renders nothing for a window it cannot
 *  place, so an answer whose `since` / `until` cannot be read leaves no box to measure, and a valid
 *  answer after it brings one. The effect therefore depends on it — run once on `[ref]`, it would
 *  find no element, return, and never attach the observer to the box that appears later. */
function useWidth(ref, fallback, mounted) {
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!mounted || !el || typeof ResizeObserver !== "function") return undefined;
    const measure = () => {
      if (el.clientWidth > 0) setWidth(Math.round(el.clientWidth));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, mounted]);
  return width;
}

export function TrendChart({
  series, bands = null, markers = [], sinceMs, untilMs, hours = 24, height = 46, big = false,
  label, cursor = null, onCursor, onPlot, onKeyDown, describedBy, roleDescription,
}) {
  const box = useRef(null);
  const placeable = validWindow(sinceMs, untilMs);
  const width = useWidth(box, big ? 640 : 320, placeable);
  const frame = plotFrame(width, height, { labels: big, markers: big, axis: big });
  const plotWidth = frame.right - frame.left;
  // The plot's width in pixels, for a caller that names a mark "within one pixel column" of a
  // cursor it moved itself (the dialog's keyboard). Before the early return: a hook runs on every render.
  useEffect(() => { onPlot?.(plotWidth); }, [onPlot, plotWidth]);
  if (!placeable) return null;
  const x = timeScale(sinceMs, untilMs, frame.left, frame.right);
  const own = bands?.own_normal ?? null;
  const values = series.flatMap((s) => s.points.map((p) => p.value));
  if (own) values.push(own.low, own.high);
  const domain = valueDomain(values);
  const y = domain ? valueScale(domain, frame.top, frame.bottom) : null;
  // The value labels: at the nearest round step, no finer than the data is measured, and only inside
  // the data — the domain's margin is the chart's, and a label there names a value nobody measured.
  // A lone reading between two steps is labelled with its own value.
  const { step: tickStep, ticks } = big && domain
    ? valueTicks(domain, 4, { extent: valueExtent(values), resolution: valueResolution(values) })
    : { step: null, ticks: [] };
  const rects = y ? bandRects(bands?.news2, domain, y, frame.left, frame.right) : [];
  const ownRect = y ? ownNormalRect(own, domain, y, frame.left, frame.right) : null;
  const marks = big ? markerMarks(markers, x, sinceMs, untilMs) : [];
  const at = cursor === null ? null : series[0]?.points[cursor] ?? null;

  const move = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = rect.width > 0 ? ((event.clientX - rect.left) / rect.width) * width : event.clientX - rect.left;
    const index = nearestIndex(series[0]?.points ?? [], x, px);
    onCursor(index >= 0 ? index : null, "mouse");
  };
  // The big chart is one tab stop whose arrow keys move the cursor (the dialog's `onKeyDown`). A chart
  // that takes keys is an APPLICATION, not an image: a screen reader stays in browse mode over an `img`
  // and keeps the arrow keys for itself, so ← → Home End would never reach the page. `aria-roledescription`
  // says in words what it is ("chart"); the name, and the hint the keys are described by, stay as they were.
  const keys = onKeyDown ? { tabIndex: 0, onKeyDown, "aria-describedby": describedBy } : {};
  let named = { "aria-hidden": "true", focusable: "false" };
  if (label) named = onKeyDown ? { role: "application", "aria-roledescription": roleDescription, "aria-label": label } : { role: "img", "aria-label": label };

  // A <span>, not a <div>: the small chart sits inside the card's <button>, which takes phrasing
  // content only.
  return (
    <span ref={box} className="block w-full min-w-0">
      <svg
        width="100%" height={height} viewBox={`0 0 ${width} ${height}`}
        className={onKeyDown ? `block rounded-ctl ${FOCUS_RING}` : "block"} {...named} {...keys}
        onMouseMove={onCursor ? move : undefined}
        onMouseLeave={onCursor ? () => onCursor(null, "mouse") : undefined}
      >
        {rects.map((r) => (
          <rect key={`${r.y}-${r.tone}`} data-band={r.tone} x={r.x} y={r.y} width={r.w} height={r.h} className={BAND_FILL[r.tone]} />
        ))}
        {ownRect ? (
          <g data-own-normal="">
            <rect x={ownRect.x} y={ownRect.y} width={ownRect.w} height={ownRect.h} className="fill-band-n" />
            {[["top", ownRect.y], ["bottom", ownRect.y + ownRect.h]].map(([side, edge]) => (
              <line
                key={side} x1={ownRect.x} x2={ownRect.x + ownRect.w} y1={crisp(edge)} y2={crisp(edge)}
                className="stroke-pri" strokeDasharray={OWN_NORMAL_DASH}
              />
            ))}
          </g>
        ) : null}
        {big && y ? ticks.map((v) => (
          <g key={`v${v}`} data-tick="value">
            <line x1={frame.left} x2={frame.right} y1={crisp(y(v))} y2={crisp(y(v))} className="stroke-grid" />
            <text x={frame.left - VALUE_LABEL_GAP} y={y(v) + VALUE_LABEL_BASELINE} textAnchor="end" className="fill-mute text-10">{tickLabel(v, tickStep)}</text>
          </g>
        )) : null}
        {y ? series.map((s) => {
          const path = linePath(s.points, x, y);
          return (
            <g key={s.key} data-series={s.key} className={s.color}>
              {path ? <path d={path} fill="none" stroke="currentColor" strokeWidth={LINE_WIDTH} strokeDasharray={CONNECTOR_DASH} /> : null}
              {s.points.filter(drawable).map((p, i) => (
                // A hollow dot is filled with the chart's OWN ground: the card under the mini chart, the
                // dialog's app background under the big one.
                <circle
                  key={`${p.iso}#${i}`} data-ts={p.iso} data-value={p.value} cx={x(p.ms)} cy={y(p.value)}
                  r={big ? DOT_RADIUS.big : DOT_RADIUS.small}
                  fill={s.hollow ? undefined : "currentColor"} className={s.hollow ? (big ? "fill-app" : "fill-card") : undefined}
                  stroke="currentColor" strokeWidth={s.hollow ? LINE_WIDTH : 0}
                />
              ))}
            </g>
          );
        }) : null}
        {marks.map((m, i) => {
          // Keyed by position as well: two alert kinds can first be seen on one reading.
          const key = `${m.kind}:${m.label}:${m.iso}:${i}`;
          return m.kind === "alarm" ? (
            <path
              key={key} data-marker="alarm" className="fill-crit"
              d={`M${m.x - ALARM_HALF_WIDTH},${frame.laneY + ALARM_HALF_HEIGHT}L${m.x},${frame.laneY - ALARM_HALF_HEIGHT}L${m.x + ALARM_HALF_WIDTH},${frame.laneY + ALARM_HALF_HEIGHT}Z`}
            />
          ) : (
            <rect
              key={key} data-marker={m.kind} x={m.x - DIAMOND_HALF} y={frame.laneY - DIAMOND_HALF}
              width={DIAMOND_HALF * 2} height={DIAMOND_HALF * 2} transform={`rotate(45 ${m.x} ${frame.laneY})`} className="fill-pri"
            />
          );
        })}
        {big ? timeTicks(sinceMs, untilMs, hours).map((ms) => {
          const text = whenText(ms, hours);   // the readout's and the table's words for an instant
          const place = timeLabelPlace(x(ms), text, width);   // anchored to an edge it would cross
          return (
            <text key={`t${ms}`} data-tick="time" x={place.x} y={frame.axisY} textAnchor={place.anchor} className="fill-mute text-10">
              {text}
            </text>
          );
        }) : null}
        {at && y && drawable(at) ? (
          <g data-cursor="">
            <line x1={x(at.ms)} x2={x(at.ms)} y1={frame.top} y2={frame.bottom} className="stroke-ink" strokeWidth={HAIRLINE} opacity={CURSOR_LINE_OPACITY} />
            <circle cx={x(at.ms)} cy={y(at.value)} r={CURSOR_RADIUS} fill="none" className="stroke-ink" strokeWidth={LINE_WIDTH} />
          </g>
        ) : null}
      </svg>
    </span>
  );
}

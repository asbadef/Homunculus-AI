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
import React, { useLayoutEffect, useRef, useState } from "react";
import { ddmm, hhmm } from "../../../i18n/dates.js";
import {
  bandRects, linePath, markerMarks, nearestIndex, ownNormalRect, plotFrame, timeScale, timeTicks,
  valueDomain, valueScale, valueTicks,
} from "./trendGeometry.js";

const BAND_FILL = { mid: "fill-band-mid", crit: "fill-band-crit" };
const drawable = (p) => Number.isFinite(p.ms) && Number.isFinite(p.value);

/** The element's width in CSS pixels, followed as it changes; `fallback` where nothing can measure
 *  it (no ResizeObserver: jsdom, an old browser). The viewBox is that width, so one unit is one pixel
 *  and a dot stays round at any size. */
function useWidth(ref, fallback) {
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver !== "function") return undefined;
    const measure = () => {
      if (el.clientWidth > 0) setWidth(Math.round(el.clientWidth));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

export function TrendChart({
  series, bands = null, markers = [], sinceMs, untilMs, hours = 24, height = 46, big = false,
  label, cursor = null, onCursor,
}) {
  const box = useRef(null);
  const width = useWidth(box, big ? 640 : 320);
  const frame = plotFrame(width, height, { labels: big, markers: big, axis: big });
  const x = timeScale(sinceMs, untilMs, frame.left, frame.right);
  const own = bands?.own_normal ?? null;
  const values = series.flatMap((s) => s.points.map((p) => p.value));
  if (own) values.push(own.low, own.high);
  const domain = valueDomain(values);
  const y = domain ? valueScale(domain, frame.top, frame.bottom) : null;
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
  const named = label ? { role: "img", "aria-label": label } : { "aria-hidden": "true", focusable: "false" };

  // A <span>, not a <div>: the small chart sits inside the card's <button>, which takes phrasing
  // content only.
  return (
    <span ref={box} className="block w-full min-w-0">
      <svg
        width="100%" height={height} viewBox={`0 0 ${width} ${height}`} className="block" {...named}
        onMouseMove={onCursor ? move : undefined}
        onMouseLeave={onCursor ? () => onCursor(null, "mouse") : undefined}
      >
        {rects.map((r) => (
          <rect key={`${r.y}-${r.tone}`} data-band={r.tone} x={r.x} y={r.y} width={r.w} height={r.h} className={BAND_FILL[r.tone]} />
        ))}
        {ownRect ? (
          <g data-own-normal="">
            <rect x={ownRect.x} y={ownRect.y} width={ownRect.w} height={ownRect.h} className="fill-band-n" />
            <line x1={ownRect.x} x2={ownRect.x + ownRect.w} y1={ownRect.y} y2={ownRect.y} className="stroke-pri" strokeDasharray="2 3" />
            <line x1={ownRect.x} x2={ownRect.x + ownRect.w} y1={ownRect.y + ownRect.h} y2={ownRect.y + ownRect.h} className="stroke-pri" strokeDasharray="2 3" />
          </g>
        ) : null}
        {big && y ? valueTicks(domain).map((v) => (
          <g key={`v${v}`} data-tick="value">
            <line x1={frame.left} x2={frame.right} y1={y(v)} y2={y(v)} className="stroke-grid" />
            <text x={frame.left - 5} y={y(v) + 3.5} textAnchor="end" className="fill-mute text-10">{v}</text>
          </g>
        )) : null}
        {y ? series.map((s) => (
          <g key={s.key} data-series={s.key} className={s.color}>
            {linePath(s.points, x, y) ? (
              <path d={linePath(s.points, x, y)} fill="none" stroke="currentColor" strokeWidth={1.5} strokeDasharray="4 3" />
            ) : null}
            {s.points.filter(drawable).map((p) => (
              <circle
                key={p.iso} data-ts={p.iso} data-value={p.value} cx={x(p.ms)} cy={y(p.value)} r={big ? 3.5 : 2.5}
                fill={s.hollow ? undefined : "currentColor"} className={s.hollow ? "fill-card" : undefined}
                stroke="currentColor" strokeWidth={s.hollow ? 1.5 : 0}
              />
            ))}
          </g>
        )) : null}
        {marks.map((m) => (m.kind === "alarm" ? (
          <path key={`a${m.iso}`} data-marker="alarm" d={`M${m.x - 6},${frame.laneY + 5}L${m.x},${frame.laneY - 5}L${m.x + 6},${frame.laneY + 5}Z`} className="fill-crit" />
        ) : (
          <rect key={`m${m.iso}`} data-marker={m.kind} x={m.x - 4} y={frame.laneY - 4} width={8} height={8} transform={`rotate(45 ${m.x} ${frame.laneY})`} className="fill-pri" />
        )))}
        {big ? timeTicks(sinceMs, untilMs, hours).map((ms) => (
          <text key={`t${ms}`} data-tick="time" x={x(ms)} y={frame.axisY} textAnchor="middle" className="fill-mute text-10">
            {hours === 72 ? `${ddmm(ms)} ${hhmm(ms)}` : hhmm(ms)}
          </text>
        )) : null}
        {at && y && drawable(at) ? (
          <g data-cursor="">
            <line x1={x(at.ms)} x2={x(at.ms)} y1={frame.top} y2={frame.bottom} className="stroke-ink" strokeWidth={1} opacity={0.5} />
            <circle cx={x(at.ms)} cy={y(at.value)} r={6} fill="none" className="stroke-ink" strokeWidth={1.5} />
          </g>
        ) : null}
      </svg>
    </span>
  );
}

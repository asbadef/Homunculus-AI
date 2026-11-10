// src/live/screens/patient/fluids/FluidChart.jsx — the fluid day hour by hour (G3-03 D10): the day's 24 columns
// from the day start, the hour's intake as a bar up from the midline, its output as a bar down — the engine's
// `in_ml` / `out_ml`, the browser adds nothing (D6, review round 1) — and the engine's cumulative balance
// (`balance_cum`) as a line, which stops at the hour now is in (an hour not yet begun carries none). SVG, no library.
//
// It judges nothing: no threshold, no colour that means «too much» or «too little» — the bars are the house's
// primary and muted inks, the line the ink. Each column carries its own words (<title>: the hour, its intake, its
// output, the balance so far), and the chart as a whole is one image named for what it shows; the numbers a
// clinician acts on are written out as text in the box above it.
import React from "react";
import { useI18n } from "../../../i18n/I18nProvider.jsx";
import { hhmm } from "../../../i18n/dates.js";
import { mlText, signedMlText } from "./fluidCodes.js";

const HOUR_MS = 3_600_000;
const COLUMNS = 24;
const COL = 20;                 // a column's width, in viewBox units
const BAR_GAP = 4;
const HALF = 60;                // the tallest bar, up or down from the midline
const MID = 66;
const AXIS_Y = MID + HALF + 18; // the hour labels under the bars
const WIDTH = COLUMNS * COL;
const HEIGHT = AXIS_Y + 4;
const LABEL_EVERY = 6;

/** The day's 24 columns: each hour row of the answer placed by its own start, so a short or reordered list
 *  still lands in the right column; an hour the answer does not carry is an empty column. */
function columnsOf(day, hours) {
  const start = Date.parse(day?.start ?? "");
  const byStart = new Map((hours ?? []).map((h) => [Date.parse(h?.start ?? ""), h]));
  return Array.from({ length: COLUMNS }, (_, i) => {
    if (!Number.isFinite(start)) {
      const h = hours?.[i] ?? null;
      return { startMs: Date.parse(h?.start ?? ""), hour: h };
    }
    const startMs = start + i * HOUR_MS;
    return { startMs, hour: byStart.get(startMs) ?? null };
  });
}

/** A number the engine sent, or null — never a 0 the answer did not say. */
const sent = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** `day` is the answer's `day` window, `hours` its hour rows. */
export function FluidChart({ day, hours }) {
  const { t, lang } = useI18n();
  const columns = columnsOf(day, hours).map((c) => ({
    ...c, in: sent(c.hour?.in_ml), out: sent(c.hour?.out_ml), cum: sent(c.hour?.balance_cum),
  }));
  const barMax = Math.max(1, ...columns.map((c) => Math.max(c.in ?? 0, c.out ?? 0)));
  const cumMax = Math.max(1, ...columns.map((c) => (c.cum === null ? 0 : Math.abs(c.cum))));
  const barH = (v) => (v > 0 ? Math.max(1, (v / barMax) * HALF) : 0);
  const line = columns
    .map((c, i) => (c.cum !== null ? `${i * COL + COL / 2},${MID - (c.cum / cumMax) * HALF}` : null))
    .filter(Boolean)
    .join(" ");
  return (
    <svg
      role="img" aria-label={t("sivi.chartLabel")} width="100%" viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="mt-2 block h-[160px] w-full text-ink"
    >
      <line x1={0} x2={WIDTH} y1={MID} y2={MID} className="stroke-grid" />
      {columns.map((c, i) => {
        const x = i * COL + BAR_GAP / 2;
        const inH = barH(c.in);
        const outH = barH(c.out);
        const title = t("sivi.column", {
          hour: Number.isFinite(c.startMs) ? hhmm(c.startMs) : "—",
          in: mlText(lang, c.in), out: mlText(lang, c.out), balance: signedMlText(lang, c.cum),
        });
        return (
          <g key={i} data-hour={i}>
            <title>{title}</title>
            {/* The whole column answers a pointer, not only its bars. */}
            <rect x={i * COL} y={0} width={COL} height={AXIS_Y - 10} fill="transparent" />
            {inH > 0 ? <rect data-bar="in" x={x} y={MID - inH} width={COL - BAR_GAP} height={inH} className="fill-pri" /> : null}
            {outH > 0 ? <rect data-bar="out" x={x} y={MID} width={COL - BAR_GAP} height={outH} className="fill-mute" /> : null}
            {i % LABEL_EVERY === 0 && Number.isFinite(c.startMs) ? (
              <text x={i * COL + 1} y={AXIS_Y} className="fill-mute text-10">{hhmm(c.startMs)}</text>
            ) : null}
          </g>
        );
      })}
      {line ? <polyline points={line} fill="none" stroke="currentColor" strokeWidth={1.5} /> : null}
    </svg>
  );
}

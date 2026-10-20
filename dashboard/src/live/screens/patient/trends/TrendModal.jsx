// src/live/screens/patient/trends/TrendModal.jsx — one card's chart, large (spec §3.2): the window
// (6 h / 24 h / 3 days, each a read of its own), a readout of the measurement under the cursor, the
// marks, and the legend.
//
// The readout is drawn for the eye and HIDDEN from assistive technology: a screen reader hears it
// only when the keyboard moved the cursor (Task 13), never on a mouse hover.
//
// THE CURSOR IS AN INSTANT, NOT AN INDEX. The state is `{ ms, how }`: the instant of the reading the
// cursor is on, and who moved it ("mouse" | "key"). It is turned into an index at render, by
// `indexAtTime` over the series as it is NOW — a poll that slides the window drops readings off the
// front and moves every index, and a cursor held as an index would silently jump to a later reading
// while the clinician reads. If the reading has slid out of the window the cursor is gone with it.
import React, { useMemo, useState } from "react";
import { useI18n } from "../../../i18n/I18nProvider.jsx";
import { ddmm, hhmm } from "../../../i18n/dates.js";
import { Modal, Seg } from "../../../ui/index.js";
import { nameOf } from "../../common/BoardState.jsx";
import { cardTitle, channelsOf } from "./cards.js";
import { TrendChart } from "./TrendChart.jsx";
import { TrendLegend } from "./TrendLegend.jsx";
import { indexAtTime, marksAtTime, parseMarkers, parsePoints } from "./trendGeometry.js";
import { measuredKeyOf, useTrends } from "./useTrends.js";

const WINDOWS = [
  { value: 6, key: "patient.trendsHours6" },
  { value: 24, key: "patient.trendsHours24" },
  { value: 72, key: "patient.trendsHours72" },
];

// The chart's height in pixels. While a window is being read the dialog holds an empty frame of the
// same height (`h-[280px]` — a literal, for Tailwind): without it the dialog shrinks, the window buttons
// jump, and a second click lands on the backdrop and closes the dialog.
const CHART_HEIGHT = 280;
const NO_VALUE = "—";

/** When, as the chart's own time labels write it: with the date over three days. */
export const whenText = (ms, hours) => (hours === 72 ? `${ddmm(ms)} ${hhmm(ms)}` : hhmm(ms));

/** What a mark says in the readout and the table: an alarm with the engine's kind, a dose by name. */
export function markText(t, mark) {
  return mark.kind === "alarm" ? `${t("patient.trendsMarkerAlarm")}: ${mark.label}` : t("patient.trendsMarkerAntibiotic");
}

/** "HH:MM · 132 /dəq", EVERY mark within a pixel after it — two alert kinds first detected on one
 *  reading are both named. A card with two series (pressure) names each and reads the other one at the
 *  SAME instant — "Sistolik AT 118 · MAP 80 mmHg", MAP being the vasopressor target — and says "—"
 *  where it has no reading then; the unit is written once when the series share it. A reading that
 *  arrived without a value prints "—", never "NaN". Everything printed is the engine's number. */
function readoutOf(t, card, series, at, marks, hours) {
  const named = card.series.length > 1;
  const shared = card.series.every((s) => s.unitKey === card.series[0].unitKey);
  const values = card.series.map((s, i) => {
    const points = series[i].points;
    const reading = i === 0 ? at : points[indexAtTime(points, at.ms)];
    return Number.isFinite(reading?.value) ? String(reading.value) : null;
  });
  const parts = card.series.map((s, i) => [
    named ? t(s.labelKey) : null,
    values[i] ?? NO_VALUE,
    !shared && values[i] !== null ? t(s.unitKey) : null,
  ].filter(Boolean).join(" "));
  const unit = shared && values.some((v) => v !== null) ? ` ${t(card.series[0].unitKey)}` : "";
  return [whenText(at.ms, hours), `${parts.join(" · ")}${unit}`, ...marks.map((m) => markText(t, m))].join(" · ");
}

export function TrendModal({ card, patient, bed, onClose }) {
  const { t } = useI18n();
  const [hours, setHours] = useState(24);
  const [cursor, setCursor] = useState(null);   // { ms, how: "mouse" | "key" } — an instant, see the header
  const [plotWidth, setPlotWidth] = useState(0);
  const trends = useTrends(patient.patient_id, hours, measuredKeyOf(patient.measuredAt));
  // Parsed once per answer, not on every render of a mouse move.
  const { channels, series, markers } = useMemo(() => {
    const byKey = channelsOf(trends.data);
    return {
      channels: byKey,
      series: card.series.map((s) => ({ key: s.key, color: s.color, hollow: s.hollow, points: parsePoints(byKey[s.key]?.points) })),
      markers: parseMarkers(trends.data?.markers),
    };
  }, [card, trends.data]);
  const primary = channels[card.series[0].key] ?? null;
  const sinceMs = Date.parse(trends.data?.since);
  const untilMs = Date.parse(trends.data?.until);
  const title = cardTitle(t, card);
  const index = cursor ? indexAtTime(series[0].points, cursor.ms) : -1;
  const at = index >= 0 ? series[0].points[index] : null;
  const marks = at ? marksAtTime(markers, at.ms, plotWidth > 0 ? (untilMs - sinceMs) / plotWidth : 0) : [];
  const readout = at ? readoutOf(t, card, series, at, marks, hours) : null;
  // The readings the chart draws — a reading that arrived without a value is not one.
  const count = series.reduce((n, s) => n + s.points.filter((p) => Number.isFinite(p.value)).length, 0);

  const choose = (value) => {
    setHours(value);
    setCursor(null);
  };
  // The chart reports an index into the series it drew; the dialog keeps the instant. Nothing changed
  // → the same state back, so a mouse move over one reading re-renders nothing.
  const moveCursor = (picked, how) => {
    const ms = picked === null ? null : series[0].points[picked]?.ms ?? null;
    setCursor((c) => {
      if (ms === null) return c === null ? c : null;
      return c !== null && c.ms === ms && c.how === how ? c : { ms, how };
    });
  };

  return (
    <Modal open wide title={[bed, nameOf(patient, t), title].filter(Boolean).join(" · ")} onClose={onClose}>
      <Seg label={t("patient.trendsHoursLabel")} value={hours} onChange={choose}
        options={WINDOWS.map((w) => ({ value: w.value, label: t(w.key) }))} />
      {trends.unreadable ? (
        <p className="m-0 mt-2 text-12 font-semibold text-att-ink">
          {t("patient.trendsUnreadable", { time: trends.lastOkAt ? hhmm(trends.lastOkAt) : "—" })}
        </p>
      ) : null}
      {trends.data ? (
        <>
          {count === 0 ? (
            <p data-no-data="" className="m-0 mt-3 min-h-[1.5em] text-13 text-mute">{t("patient.trendsNoData")}</p>
          ) : (
            <p data-readout="" aria-hidden="true" className="m-0 mt-3 min-h-[1.5em] font-data text-13 font-semibold text-ink">
              {readout ?? t("patient.trendsReadoutIdle")}
            </p>
          )}
          <TrendChart
            series={series} bands={primary?.bands ?? null} markers={markers} sinceMs={sinceMs} untilMs={untilMs}
            hours={hours} height={CHART_HEIGHT} big label={t("patient.trendsChartLabel", { channel: title, hours, count })}
            cursor={index >= 0 ? index : null} onPlot={setPlotWidth} onCursor={moveCursor}
          />
          <TrendLegend card={card} channels={channels} source={trends.data.bands_source} truncated={trends.data.markers_truncated === true} />
        </>
      ) : (
        <>
          <p aria-hidden="true" className="m-0 mt-3 min-h-[1.5em] font-data text-13" />
          <div data-chart-frame="" className="mt-3 flex h-[280px] items-center justify-center">
            {trends.loading ? <p className="m-0 text-12.5 text-mute">{t("patient.trendsLoading")}</p> : null}
          </div>
        </>
      )}
    </Modal>
  );
}

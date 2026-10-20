// src/live/screens/patient/trends/TrendModal.jsx — one card's chart, large (spec §3.2): the window
// (6 h / 24 h / 3 days, each a read of its own), a readout of the measurement under the cursor, the
// marks, and the legend.
//
// The readout is drawn for the eye and HIDDEN from assistive technology: a screen reader hears it
// only when the keyboard moved the cursor (Task 13), never on a mouse hover.
import React, { useState } from "react";
import { useI18n } from "../../../i18n/I18nProvider.jsx";
import { ddmm, hhmm } from "../../../i18n/dates.js";
import { Modal, Seg } from "../../../ui/index.js";
import { nameOf } from "../../common/BoardState.jsx";
import { cardTitle, channelsOf } from "./cards.js";
import { TrendChart } from "./TrendChart.jsx";
import { TrendLegend } from "./TrendLegend.jsx";
import { marksAtTime, parseMarkers, parsePoints } from "./trendGeometry.js";
import { measuredKeyOf, useTrends } from "./useTrends.js";

const WINDOWS = [
  { value: 6, key: "patient.trendsHours6" },
  { value: 24, key: "patient.trendsHours24" },
  { value: 72, key: "patient.trendsHours72" },
];

/** When, as the chart's own time labels write it: with the date over three days. */
export const whenText = (ms, hours) => (hours === 72 ? `${ddmm(ms)} ${hhmm(ms)}` : hhmm(ms));

/** What a mark says in the readout and the table: an alarm with the engine's kind, a dose by name. */
export function markText(t, mark) {
  return mark.kind === "alarm" ? `${t("patient.trendsMarkerAlarm")}: ${mark.label}` : t("patient.trendsMarkerAntibiotic");
}

/** "HH:MM · 132 /dəq", the channel named when the card has two, and EVERY mark within a pixel — two
 *  alert kinds first detected on one reading are both named. */
function readoutOf(t, card, point, marks, hours) {
  const series = card.series[0];
  const value = `${card.series.length > 1 ? `${t(series.labelKey)} ` : ""}${point.value} ${t(series.unitKey)}`;
  return [whenText(point.ms, hours), value, ...marks.map((m) => markText(t, m))].join(" · ");
}

export function TrendModal({ card, patient, bed, onClose }) {
  const { t } = useI18n();
  const [hours, setHours] = useState(24);
  const [cursor, setCursor] = useState(null);   // { index, how: "mouse" | "key" }
  const [plotWidth, setPlotWidth] = useState(0);
  const trends = useTrends(patient.patient_id, hours, measuredKeyOf(patient.measuredAt));
  const channels = channelsOf(trends.data);
  const primary = channels[card.series[0].key] ?? null;
  const series = card.series.map((s) => ({ key: s.key, color: s.color, hollow: s.hollow, points: parsePoints(channels[s.key]?.points) }));
  const markers = parseMarkers(trends.data?.markers);
  const sinceMs = Date.parse(trends.data?.since);
  const untilMs = Date.parse(trends.data?.until);
  const title = cardTitle(t, card);
  const at = cursor ? series[0].points[cursor.index] ?? null : null;
  const marks = at ? marksAtTime(markers, at.ms, plotWidth > 0 ? (untilMs - sinceMs) / plotWidth : 0) : [];
  const readout = at ? readoutOf(t, card, at, marks, hours) : null;
  const count = series.reduce((n, s) => n + s.points.length, 0);

  const choose = (value) => {
    setHours(value);
    setCursor(null);
  };

  return (
    <Modal open wide title={[bed, nameOf(patient, t), title].join(" · ")} onClose={onClose}>
      <Seg label={t("patient.trendsHoursLabel")} value={hours} onChange={choose}
        options={WINDOWS.map((w) => ({ value: w.value, label: t(w.key) }))} />
      {trends.unreadable ? (
        <p className="m-0 mt-2 text-12 font-semibold text-att-ink">
          {t("patient.trendsUnreadable", { time: trends.lastOkAt ? hhmm(trends.lastOkAt) : "—" })}
        </p>
      ) : null}
      {trends.data ? (
        <>
          <p data-readout="" aria-hidden="true" className="m-0 mt-3 min-h-[1.5em] font-data text-13 font-semibold text-ink">
            {readout ?? t("patient.trendsReadoutIdle")}
          </p>
          <TrendChart
            series={series} bands={primary?.bands ?? null} markers={markers} sinceMs={sinceMs} untilMs={untilMs}
            hours={hours} height={280} big label={t("patient.trendsChartLabel", { channel: title, hours, count })}
            cursor={cursor?.index ?? null} onPlot={setPlotWidth}
            onCursor={(index, how) => setCursor(index === null ? null : { index, how })}
          />
          <TrendLegend card={card} channels={channels} source={trends.data.bands_source} truncated={trends.data.markers_truncated === true} />
        </>
      ) : trends.loading ? (
        <p className="m-0 mt-3 text-12.5 text-mute">{t("patient.trendsLoading")}</p>
      ) : null}
    </Modal>
  );
}

// src/live/screens/patient/trends/TrendTable.jsx — the big chart as a table (spec §3.2, §7): every
// measurement the chart draws, newest first, with the ENGINE'S NEWS2 points for that reading (the
// endpoint's third column — printed, never looked up here), and each mark as a row of its own. The
// same numbers the SVG shows; TrendModal.test.jsx holds the two views equal.
import React from "react";
import { useI18n } from "../../../i18n/I18nProvider.jsx";
import { Table } from "../../../ui/index.js";
import { cardTitle } from "./cards.js";
import { parseMarkers, parsePoints } from "./trendGeometry.js";
import { markText, pointsText, whenText } from "./trendText.js";

export function TrendTable({ card, channels, markers, hours }) {
  const { t } = useI18n();
  const two = card.series.length > 1;
  const rows = [
    ...card.series.flatMap((s) => parsePoints(channels[s.key]?.points).map((p) => ({ ms: p.ms, key: `${s.key}-${p.iso}`, series: s, p }))),
    ...parseMarkers(markers).map((m) => ({ ms: m.ms, key: `${m.kind}-${m.iso}`, mark: m })),
  ].sort((a, b) => b.ms - a.ms);
  return (
    <Table caption={t("patient.trendsCaption", { channel: cardTitle(t, card) })} className="mt-3">
      <thead>
        <tr>
          <th scope="col">{t("patient.trendsColTime")}</th>
          {two ? <th scope="col">{t("patient.trendsColChannel")}</th> : null}
          <th scope="col">{t("patient.trendsColValue")}</th>
          <th scope="col">{t("patient.trendsColUnit")}</th>
          <th scope="col">{t("patient.trendsColBand")}</th>
          <th scope="col">{t("patient.trendsColMarker")}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (row.mark ? (
          // Keyed by position as well, as the chart's dots are: two readings can share an instant.
          <tr key={`${row.key}#${i}`} data-mark={row.mark.kind}>
            <th scope="row" className="font-data font-semibold">{whenText(row.ms, hours)}</th>
            {two ? <td /> : null}
            <td />
            <td />
            <td />
            <td>{markText(t, row.mark)}</td>
          </tr>
        ) : (
          <tr key={`${row.key}#${i}`} data-ts={row.p.iso} data-value={row.p.value} data-series={row.series.key}>
            <th scope="row" className="font-data font-semibold">{whenText(row.ms, hours)}</th>
            {two ? <td>{t(row.series.labelKey)}</td> : null}
            <td className="font-data font-bold">{Number.isFinite(row.p.value) ? row.p.value : "—"}</td>
            <td>{t(row.series.unitKey)}</td>
            <td className="font-data">{pointsText(row.p.points)}</td>
            <td />
          </tr>
        )))}
      </tbody>
    </Table>
  );
}

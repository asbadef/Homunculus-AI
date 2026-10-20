// src/live/screens/patient/trends/TrendTable.jsx — the big chart as a table (spec §3.2, §7): every
// measurement the chart draws, newest first, with the ENGINE'S NEWS2 points for that reading (the
// endpoint's third column — printed, never looked up here), and each mark as a row of its own. It is
// handed the dialog's own parsed series and markers — the very arrays the SVG draws — so the two views
// hold the same numbers by construction; TrendModal.test.jsx holds them equal.
import React from "react";
import { useI18n } from "../../../i18n/I18nProvider.jsx";
import { Table } from "../../../ui/index.js";
import { cardTitle } from "./cards.js";
import { markText, pointsText, whenText } from "./trendText.js";

/** The table's rows, newest first. A reading with no value is not one (the chart draws no dot for it).
 *  At one instant a series' LATER reading comes first — it is the one the chart and the readout take —
 *  then the card's series in their order, then the marks.
 *
 *  A row's key is what it is — its series (or kind and label) and its instant — with a counter for the
 *  second and later row of the same: it does not move when a newer reading is added, so a poll adds a
 *  row instead of re-mounting the body (a position key would). */
function rowsOf(card, series, markers) {
  const seen = new Map();
  const keyed = (base) => {
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n === 0 ? base : `${base}#${n}`;
  };
  const rows = [
    ...card.series.flatMap((s, i) => (series[i]?.points ?? []).flatMap((p, j) => (
      Number.isFinite(p.value) && Number.isFinite(p.ms)
        ? [{ ms: p.ms, rank: i, order: j, key: keyed(`${s.key}-${p.iso}`), series: s, p }]
        : []
    ))),
    ...(markers ?? []).map((m, j) => ({ ms: m.ms, rank: card.series.length, order: j, key: keyed(`${m.kind}:${m.label}-${m.iso}`), mark: m })),
  ];
  return rows.sort((a, b) => b.ms - a.ms || a.rank - b.rank || b.order - a.order);
}

/** The NEWS2 cell. The engine's points where it sent them; for a NEWS2 channel it sent none for, a dash
 *  and — for a screen reader — the reason (the card's own split, X24, but worded for THIS reading: the
 *  card's sentence says "the last reading", which is true there and false in a row); for a channel NEWS2 does not
 *  score (MAP, lactate: the engine sent no bands), nothing at all — a dash there would read as a
 *  missing score. Never a comparison with a band edge. */
function PointsCell({ points, news2 }) {
  const { t } = useI18n();
  if (Number.isInteger(points)) return <td className="font-data">{pointsText(points)}</td>;
  if (!news2) return <td />;
  return (
    <td className="font-data">
      <span aria-hidden="true">{pointsText(points)}</span>
      <span className="sr-only">{t("patient.trendsPointsUnknownRowSr")}</span>
    </td>
  );
}

export function TrendTable({ card, channels, series, markers, hours }) {
  const { t } = useI18n();
  const two = card.series.length > 1;
  const rows = rowsOf(card, series, markers);
  if (rows.length === 0) return null;      // nothing to list: the dialog says so, not an empty captioned table
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
        {rows.map((row) => (row.mark ? (
          <tr key={row.key} data-mark={row.mark.kind}>
            <th scope="row" className="font-data font-semibold">{whenText(row.ms, hours)}</th>
            {two ? <td /> : null}
            <td />
            <td />
            <td />
            <td>{markText(t, row.mark)}</td>
          </tr>
        ) : (
          <tr key={row.key} data-ts={row.p.iso} data-value={row.p.value} data-series={row.series.key}>
            <th scope="row" className="font-data font-semibold">{whenText(row.ms, hours)}</th>
            {two ? <td>{t(row.series.labelKey)}</td> : null}
            <td className="font-data font-bold">{row.p.value}</td>
            <td>{t(row.series.unitKey)}</td>
            <PointsCell points={row.p.points} news2={Array.isArray(channels[row.series.key]?.bands?.news2)} />
            <td />
          </tr>
        )))}
      </tbody>
    </Table>
  );
}

// src/live/screens/patient/trends/TrendTable.jsx — the big chart as a table (spec §3.2, §7): every
// measurement the chart draws, newest first, with the ENGINE'S NEWS2 points for that reading (the
// endpoint's third column — printed, never looked up here), and each mark as a row of its own. It is
// handed the dialog's own parsed series and markers — the very arrays the SVG draws — so the two views
// hold the same numbers by construction; TrendModal.test.jsx holds them equal.
//
// G3-01 (D13): a reading typed in by hand says «elle», and to a `clinical.chart` holder offers «Hatalı giriş»
// (the dialog's host opens it, `onWithdraw`). A withdrawn hand entry is a row of its own, struck through, with its
// reason, who and when — it is in no score, so it has no points and is on no line. Each «Hatalı giriş» is described
// by its row's time and value (and series, on the pressure card): the buttons share one name. A struck row says
// «hatalı giriş olarak işaretlendi» in words beside the <s>, which a screen reader does not read as struck, and can
// take focus (`tabIndex={-1}`): after a withdrawal the dialog puts focus there, because the button that had it is gone.
import React, { useId } from "react";
import { useI18n } from "../../../i18n/I18nProvider.jsx";
import { Button, FOCUS_RING, Table } from "../../../ui/index.js";
import { cardTitle } from "./cards.js";
import { handEntryOf } from "./trendGeometry.js";
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
        ? [{ ms: p.ms, rank: i, order: j, key: keyed(`${s.key}-${p.iso}`), series: s, p, hand: handEntryOf(series[i]?.manual, p) }]
        : []
    ))),
    // G3-01 (D13): after the readings of its instant, each withdrawn hand entry of the series.
    ...card.series.flatMap((s, i) => (series[i]?.withdrawn ?? []).map((m) => (
      { ms: m.ms, rank: i, order: -1, key: keyed(`${s.key}-withdrawn-${m.entry}`), series: s, withdrawn: m }))),
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

export function TrendTable({ card, channels, series, markers, hours, canRetract = false, onWithdraw }) {
  const { t } = useI18n();
  const base = useId();
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
        ) : row.withdrawn ? (
          <tr
            key={row.key} data-withdrawn={row.withdrawn.entry} data-series={row.series.key} tabIndex={-1}
            className={`text-mute outline-none ${FOCUS_RING}`}
          >
            <th scope="row" className="font-data font-semibold">{whenText(row.ms, hours)}</th>
            {two ? <td>{t(row.series.labelKey)}</td> : null}
            <td className="font-data"><s>{row.withdrawn.value}</s><span className="sr-only"> {t("olcum.retractedShort")}</span></td>
            <td>{t(row.series.unitKey)}</td>
            <td />
            <td>
              {t("olcum.retracted", {
                reason: row.withdrawn.retracted.reason, who: row.withdrawn.retracted.by,
                time: row.withdrawn.retracted.ms === null ? "—" : whenText(row.withdrawn.retracted.ms, hours),
              })}
            </td>
          </tr>
        ) : (
          <ReadingRow
            key={row.key} row={row} id={`${base}-${row.key}`} two={two} hours={hours}
            news2={Array.isArray(channels[row.series.key]?.bands?.news2)}
            offer={Boolean(row.hand) && canRetract} onWithdraw={onWithdraw}
          />
        )))}
      </tbody>
    </Table>
  );
}

/** One reading. A hand one says «elle»; offered to a `clinical.chart` holder, its «Hatalı giriş» is described by
 *  the row's time, its series on the pressure card, and its value (`id` is the row's own prefix for them). */
function ReadingRow({ row, id, two, hours, news2, offer, onWithdraw }) {
  const { t } = useI18n();
  const ids = offer ? { time: `${id}-t`, series: two ? `${id}-s` : undefined, value: `${id}-v` } : {};
  return (
    <tr data-ts={row.p.iso} data-value={row.p.value} data-series={row.series.key}>
      <th scope="row" id={ids.time} className="font-data font-semibold">{whenText(row.ms, hours)}</th>
      {two ? <td id={ids.series}>{t(row.series.labelKey)}</td> : null}
      <td id={ids.value} className="font-data font-bold">{row.p.value}</td>
      <td>{t(row.series.unitKey)}</td>
      <PointsCell points={row.p.points} news2={news2} />
      <td>
        {row.hand ? <span className="font-semibold">{t("olcum.hand")}</span> : null}
        {offer ? (
          <Button
            size="sm" variant="ghost" icon="x" className="ml-2"
            aria-describedby={[ids.time, ids.series, ids.value].filter(Boolean).join(" ")} onClick={() => onWithdraw(row.series, row.hand)}
          >
            {t("olcum.retract")}
          </Button>
        ) : null}
      </td>
    </tr>
  );
}

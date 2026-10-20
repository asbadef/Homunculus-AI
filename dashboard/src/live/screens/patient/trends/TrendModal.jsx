// src/live/screens/patient/trends/TrendModal.jsx — one card's chart, large (spec §3.2): the window
// (6 h / 24 h / 3 days, each a read of its own), a readout of the measurement under the cursor, the
// marks and the legend — and the same numbers as a table (Grafik | Tablo).
//
// The cursor follows the mouse, and the arrow keys, Home and End when the chart has focus (the chart
// is an application to a screen reader, not an image — see TrendChart — and only a chart with a
// reading to step to takes the keys at all). The readout is drawn for the eye and HIDDEN from assistive
// technology; a screen reader hears it (`Announce`) when a KEYBOARD move changes what it says — never on
// a mouse hover, which would drown everything else the dialog says. The live region is keyed on its
// text, so a move to a stop that reads the same (the same minute and value), or → at the last stop,
// says nothing again.
//
// THE CURSOR IS AN INSTANT, NOT AN INDEX. The state is `{ ms, how }`: the instant of the reading the
// cursor is on, and who moved it ("mouse" | "key"). It is turned into an index at render, by
// `indexAtTime` over the series as it is NOW — a poll that slides the window drops readings off the
// front and moves every index, and a cursor held as an index would silently jump to a later reading
// while the clinician reads. If the reading has slid out of the window the cursor is gone with it.
// Switching to the table lets it go too: the chart is not on screen, and its readout is not for saying.
//
// It opens with focus on the pressed window option — what the dialog is showing — not on whichever
// control happens to come first.
import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { useI18n } from "../../../i18n/I18nProvider.jsx";
import { hhmm } from "../../../i18n/dates.js";
import { Announce, Modal, Seg } from "../../../ui/index.js";
import { nameOf } from "../../common/BoardState.jsx";
import { cardTitle, channelsOf } from "./cards.js";
import { TrendChart } from "./TrendChart.jsx";
import { TrendLegend, TrendNotes } from "./TrendLegend.jsx";
import { TrendTable } from "./TrendTable.jsx";
import { indexAtTime, marksAtTime, parseMarkers, parsePoints, validWindow } from "./trendGeometry.js";
import { markBeside, valueBeside, whenText } from "./trendText.js";
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

/** The drawable reading of a series nearest an instant, within `tolerance` milliseconds — the later one
 *  on a tie — or null. */
function readingNear(points, ms, tolerance) {
  let best = null;
  let distance = Infinity;
  for (const p of points) {
    if (!Number.isFinite(p.value) || !Number.isFinite(p.ms)) continue;
    const d = Math.abs(p.ms - ms);
    if (d <= tolerance && d <= distance) {
      best = p;
      distance = d;
    }
  }
  return best;
}

/** "HH:MM · 132 /dəq", EVERY mark within a pixel after it — two alert kinds first detected on one
 *  reading are both named, each with its own time when that reads differently. A card with two series
 *  (pressure) names each and reads the other one AT that instant — "Sistolik AT 118 · MAP 80 mmHg",
 *  MAP being the vasopressor target — meaning the nearest reading within one pixel column (`msPerPx`,
 *  the tolerance the marks use): a MAP stamped seconds from the systolic is, on the chart, the same
 *  moment. When it reads at another minute it says so ("MAP 64 mmHg (10:17)") rather than borrow the
 *  systolic's time, and each number then keeps its own unit; otherwise the unit is written once when the
 *  series share it. "—" where a series has no reading then. A reading that arrived without a value
 *  prints "—", never "NaN". Everything printed is the engine's number. */
function readoutOf(t, card, series, at, marks, hours, msPerPx) {
  const named = card.series.length > 1;
  const shared = card.series.every((s) => s.unitKey === card.series[0].unitKey);
  const readings = card.series.map((s, i) => {
    const reading = i === 0 ? at : readingNear(series[i].points, at.ms, msPerPx);
    return Number.isFinite(reading?.value) ? reading : null;
  });
  const apart = readings.map((r) => r !== null && whenText(r.ms, hours) !== whenText(at.ms, hours));
  const unitEach = !shared || apart.some(Boolean);
  const parts = card.series.map((s, i) => {
    const reading = readings[i];
    if (reading === null) return [named ? t(s.labelKey) : null, NO_VALUE].filter(Boolean).join(" ");
    const value = [String(reading.value), unitEach ? t(s.unitKey) : null].filter(Boolean).join(" ");
    return [named ? t(s.labelKey) : null, valueBeside(value, reading.ms, at.ms, hours)].filter(Boolean).join(" ");
  });
  const unit = !unitEach && readings.some((r) => r !== null) ? ` ${t(card.series[0].unitKey)}` : "";
  return [whenText(at.ms, hours), `${parts.join(" · ")}${unit}`, ...marks.map((m) => markBeside(t, m, at.ms, hours))].join(" · ");
}

/** The keyboard's stops: the instants of the readings that can be drawn, in time order — two readings
 *  at one instant are ONE stop (the chart draws them in one column). */
function stopsOf(points) {
  const out = [];
  for (const p of points) {
    if (Number.isFinite(p.value) && Number.isFinite(p.ms) && out[out.length - 1] !== p.ms) out.push(p.ms);
  }
  return out;
}

/** The instant a key moves the cursor to, or null for any other key. From no cursor (or one whose
 *  reading has slid out of the window) → the first stop, ← the last. */
function step(key, stops, ms) {
  if (stops.length === 0) return null;
  const at = ms === null ? -1 : stops.indexOf(ms);
  if (key === "Home") return stops[0];
  if (key === "End") return stops[stops.length - 1];
  if (key === "ArrowRight") return at < 0 ? stops[0] : stops[Math.min(at + 1, stops.length - 1)];
  if (key === "ArrowLeft") return at < 0 ? stops[stops.length - 1] : stops[Math.max(at - 1, 0)];
  return null;
}

export function TrendModal({ card, patient, bed, onClose }) {
  const { t } = useI18n();
  const hintId = useId();
  const controls = useRef(null);
  const [hours, setHours] = useState(24);
  const [view, setView] = useState("graph");
  const [cursor, setCursor] = useState(null);   // { ms, how: "mouse" | "key" } — an instant, see the header
  const [plotWidth, setPlotWidth] = useState(0);
  const trends = useTrends(patient.patient_id, hours, measuredKeyOf(patient.measuredAt));
  // Parsed once per answer, not on every render of a mouse move. The table is handed these very arrays.
  const { channels, series, markers, stops } = useMemo(() => {
    const byKey = channelsOf(trends.data);
    const drawn = card.series.map((s) => ({ key: s.key, color: s.color, hollow: s.hollow, points: parsePoints(byKey[s.key]?.points) }));
    return { channels: byKey, series: drawn, markers: parseMarkers(trends.data?.markers), stops: stopsOf(drawn[0].points) };
  }, [card, trends.data]);
  const primary = channels[card.series[0].key] ?? null;
  const sinceMs = Date.parse(trends.data?.since);
  const untilMs = Date.parse(trends.data?.until);
  const title = cardTitle(t, card);
  const index = cursor ? indexAtTime(series[0].points, cursor.ms) : -1;
  const at = index >= 0 ? series[0].points[index] : null;
  const msPerPx = plotWidth > 0 ? (untilMs - sinceMs) / plotWidth : 0;   // one pixel column of the plot
  const marks = at ? marksAtTime(markers, at.ms, msPerPx) : [];
  const readout = at ? readoutOf(t, card, series, at, marks, hours, msPerPx) : null;
  // The readings the chart draws — a reading that arrived without a value is not one.
  const count = series.reduce((n, s) => n + s.points.filter((p) => Number.isFinite(p.value)).length, 0);
  // The chart takes the keys (and is a tab stop) only while there is a stop to step to, on a chart that
  // is drawn: keys that do nothing are a trap, not a control. The cursor follows the card's FIRST series.
  const keyed = stops.length > 0 && validWindow(sinceMs, untilMs);
  const truncated = trends.data?.markers_truncated === true;

  // After the kit Modal's own effect (a child's runs first) put focus on the body's first control.
  useEffect(() => { controls.current?.querySelector("[aria-pressed='true']")?.focus(); }, []);

  const choose = (value) => {
    setHours(value);
    setCursor(null);
  };
  // The table has no cursor, and `Announce` must not speak a readout for a chart nobody can see.
  const chooseView = (value) => {
    setView(value);
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
  const onKeyDown = (event) => {
    // Alt+← is the browser's Back and Ctrl+Home the top of the page: not the chart's to take.
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const next = step(event.key, stops, at ? at.ms : null);
    if (next === null) return;
    event.preventDefault();
    setCursor({ ms: next, how: "key" });
  };

  return (
    <Modal open wide title={[bed, nameOf(patient, t), title].filter(Boolean).join(" · ")} onClose={onClose}>
      <div ref={controls} className="flex flex-wrap items-center gap-2">
        <Seg label={t("patient.trendsHoursLabel")} value={hours} onChange={choose}
          options={WINDOWS.map((w) => ({ value: w.value, label: t(w.key) }))} />
        <Seg label={t("patient.trendsViewLabel")} value={view} onChange={chooseView}
          options={[{ value: "graph", label: t("patient.trendsGraph") }, { value: "table", label: t("patient.trendsTable") }]} />
      </div>
      {trends.unreadable ? (
        <p className="m-0 mt-2 text-12 font-semibold text-att-ink">
          {t("patient.trendsUnreadable", { time: trends.lastOkAt ? hhmm(trends.lastOkAt) : "—" })}
        </p>
      ) : null}
      {trends.data && view === "graph" ? (
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
            onKeyDown={keyed ? onKeyDown : undefined} describedBy={keyed ? hintId : undefined}
            roleDescription={t("patient.trendsChartRole")}
          />
          {keyed ? <p id={hintId} className="m-0 mt-1 text-11 text-mute">{t("patient.trendsKeysHint")}</p> : null}
          <TrendLegend card={card} channels={channels} source={trends.data.bands_source} truncated={truncated} />
        </>
      ) : null}
      {trends.data && view === "table" ? (
        <>
          {count === 0 ? <p data-no-data="" className="m-0 mt-3 text-13 text-mute">{t("patient.trendsNoData")}</p> : null}
          <TrendTable card={card} channels={channels} series={series} markers={markers} hours={hours} />
          <TrendNotes card={card} channels={channels} truncated={truncated} />
        </>
      ) : null}
      {!trends.data ? (
        <>
          <p aria-hidden="true" className="m-0 mt-3 min-h-[1.5em] font-data text-13" />
          <div data-chart-frame="" className="mt-3 flex h-[280px] items-center justify-center">
            {trends.loading ? <p className="m-0 text-12.5 text-mute">{t("patient.trendsLoading")}</p> : null}
          </div>
        </>
      ) : null}
      <Announce text={cursor?.how === "key" && readout ? readout : ""} />
    </Modal>
  );
}

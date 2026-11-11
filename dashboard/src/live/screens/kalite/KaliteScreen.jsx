// src/live/screens/kalite/KaliteScreen.jsx — G4-03 «Kalite göstergeleri» (spec
// docs/superpowers/specs/2026-11-11-g4-kalite-gostergeleri-design.md, D5), for `quality.view`. Read-only; no patient
// name, key or id anywhere, and no person's name. Top to bottom: the header (the period switch, «HH:MM itibarıyla»,
// «Yenile»), the coverage line, the cards, the units table (a unit's name selects it), the snooze reasons and the
// alarms by kind for the selection. The rules are kalite.js's; this file words them. Every number is real or a «—»
// with its reason (Decision 18). Read on open, on a period change and on «Yenile» — never on a timer; the newest read
// wins (usePeriodRead).
import React, { useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { ddmmhhmm, hhmm } from "../../i18n/dates.js";
import { useSession } from "../../session/SessionProvider.jsx";
import { readErrorText } from "../../apiErrors.js";
import { Alert, Box, Button, FOCUS_RING, Note, Seg, Table } from "../../ui/index.js";
import { DEFAULT_PERIOD, PERIODS, WHY, readSource } from "../ozet/ozet.js";
import { usePeriodRead } from "../ozet/useSummaryReads.js";
import { Missing, PERIOD_KEYS, durationText } from "../ozet/words.jsx";
import { REASON_KEYS, TOTAL, UNPLACED, isQualityAnswer, qualityPage, readQuality, selectionOf } from "./kalite.js";

const CARDS = Object.freeze([
  "kalite.cards.median", "kalite.cards.rate", "kalite.cards.escalated", "kalite.cards.unanswered",
  "kalite.cards.snoozes", "kalite.cards.rrt", "kalite.cards.countersign",
]);
const COLUMNS = Object.freeze([
  "kalite.units.colUnit", "kalite.units.colEpisodes", "kalite.units.colMedian", "kalite.units.colP90",
  "kalite.units.colRate", "kalite.units.colEscalated", "kalite.units.colUnanswered", "kalite.units.colSnoozes",
  "kalite.units.colRrt", "kalite.units.colHandovers", "kalite.units.colCountersign",
]);
const KIND_COLUMNS = Object.freeze([
  "kalite.kinds.colKind", "kalite.kinds.colEpisodes", "kalite.kinds.colAnswered", "kalite.kinds.colEscalated",
  "kalite.kinds.colUnanswered", "kalite.kinds.colMedian",
]);

/** «—» and a word: a figure over nothing — a median with nothing answered, a rate with nothing settled. Not a reason
 *  for a missing source (that is `Missing`): the answer is real; the figure has nothing to stand on. */
function None({ text = null }) {
  return (
    <span data-none>
      <span className="font-data font-bold">—</span>
      {text ? <>{" "}<span className="text-12 font-normal text-mute">{text}</span></> : null}
    </span>
  );
}

function Card({ title, value, extra = null }) {
  return (
    <li className="flex min-w-[180px] flex-1 flex-col gap-1 rounded-box border border-line bg-card px-[14px] py-3">
      <h3 className="m-0 font-text text-13 font-semibold">{title}</h3>
      <p className="m-0 font-data text-23 font-bold" data-card-value>{value}</p>
      {extra ? <p className="m-0 text-12 text-mute">{extra}</p> : null}
    </li>
  );
}

/** The cards' heading names whose sum they are only once an answer says so: without one, a neutral heading — never
 *  «Hastane geneli» over a scoped caller's «—» (G4-03 review). */
function cardsTitleKey(page) {
  if (!page.ok) return "kalite.cards.titleUnknown";
  return page.scoped ? "kalite.cards.titleScoped" : "kalite.cards.title";
}

function Cards({ t, page, period }) {
  const title = t(cardsTitleKey(page), { period: t(PERIOD_KEYS[period].text) });
  let cards;
  if (!page.ok) {
    cards = CARDS.map((key) => <Card key={key} title={t(key)} value={<Missing t={t} why={page.why} big />} />);
  } else {
    const { alarms, snoozes, rrt, handovers } = page.total;
    cards = [
      <Card key="median" title={t("kalite.cards.median")}
        value={alarms.median ? durationText(t, alarms.median) : <None text={t("ozet.q.noAnswered")} />} />,
      <Card key="rate" title={t("kalite.cards.rate")}
        value={alarms.pct === null ? <None text={t("ozet.q.unsettled")} /> : t("kalite.pct", { pct: alarms.pct })}
        extra={alarms.settled > 0 ? t("kalite.cards.rateOf", { answered: alarms.answered, settled: alarms.settled }) : null} />,
      <Card key="escalated" title={t("kalite.cards.escalated")} value={alarms.escalated} />,
      <Card key="unanswered" title={t("kalite.cards.unanswered")} value={alarms.unanswered}
        extra={alarms.unanswered > 0 ? t("kalite.cards.selfResolved", { n: alarms.selfResolved }) : null} />,
      <Card key="snoozes" title={t("kalite.cards.snoozes")} value={snoozes.count}
        extra={snoozes.count > 0 ? t("kalite.cards.snoozeSplit", { high: snoozes.high, moderate: snoozes.moderate }) : null} />,
      <Card key="rrt" title={t("kalite.cards.rrt")} value={rrt} />,
      <Card key="countersign" title={t("kalite.cards.countersign")}
        value={handovers.median ? durationText(t, handovers.median) : <None text={t("kalite.cards.noCountersigned")} />} />,
    ];
  }
  return (
    <section aria-labelledby="kalite-cards" className="flex flex-col gap-2">
      <h2 id="kalite-cards" className="m-0 font-display text-17 font-bold">{title}</h2>
      <ul className="m-0 flex list-none flex-wrap gap-2.5 p-0">{cards}</ul>
    </section>
  );
}

/** How many alarm episodes could be tied to a unit, and why the rest could not — or, for a scoped caller, that these
 *  are her units' only; a period with none says so in words, never «0 of 0» (G4-03 review). An empty reach has no
 *  line: the units box says «Kapsamınızda birim yok» once. A truncated read says so, and from when its alarms are
 *  counted. */
function coverageLine(t, page) {
  const { episodes, placed } = page.coverage;
  if (episodes === 0) return t(page.scoped ? "kalite.noEpisodesScoped" : "kalite.noEpisodes");
  return page.scoped ? t("kalite.coverageScoped", { placed })
    : `${t("kalite.coverage", { episodes, placed })} ${t("kalite.coverageWhy")}`;
}

function Coverage({ t, page }) {
  if (!page.ok || page.noReach) return null;
  const line = coverageLine(t, page);
  return (
    <div className="flex flex-col gap-2" data-coverage>
      <p className="m-0 text-13">{line}</p>
      {page.truncated ? <Note tone="warn">{t("kalite.truncated", { from: ddmmhhmm(page.windowFromMs) })}</Note> : null}
    </div>
  );
}

function UnitRow({ t, row, name, on, onSelect }) {
  const { alarms, snoozes, handovers } = row;
  const time = (d) => (d ? durationText(t, d) : <None />);
  return (
    <tr>
      <th scope="row">
        <button type="button" aria-pressed={on} onClick={() => onSelect(row.key)}
          className={`cursor-pointer rounded-sm border-0 bg-transparent p-0 text-left font-text font-semibold underline-offset-2 hover:underline ${on ? "text-pri underline" : ""} ${FOCUS_RING}`}>
          {name}
        </button>
      </th>
      <td className="font-data">{alarms.episodes}</td>
      <td className="font-data">{time(alarms.median)}</td>
      <td className="font-data">{time(alarms.p90)}</td>
      <td className="font-data">{alarms.pct === null ? <None text={t("ozet.q.unsettled")} /> : t("kalite.pct", { pct: alarms.pct })}</td>
      <td className="font-data">{alarms.escalated}</td>
      <td className="font-data">{`${alarms.unanswered} (${alarms.selfResolved})`}</td>
      <td className="font-data">{snoozes.count}</td>
      <td className="font-data">{row.rrt}</td>
      {/* The unplaced row has no handovers (every handover has a unit): «—», never a blank or a 0. */}
      <td className="font-data">{handovers ? `${handovers.opened} / ${handovers.countersigned} / ${handovers.waiting}` : <None />}</td>
      <td className="font-data">{handovers ? time(handovers.median) : <None />}</td>
    </tr>
  );
}

function UnitsBox({ t, page, selectedKey, onSelect }) {
  let body;
  if (!page.ok) {
    body = page.why === WHY.loading ? <p className="m-0 text-13 text-mute">{t("kalite.units.loading")}</p>
      : <Note tone="warn">{t("kalite.units.missing", { why: t(`ozet.why.${page.why}`) })}</Note>;
  } else if (page.noReach) {
    // Only an empty reach: a unit in reach is listed even when quiet, with its zeros.
    body = <p className="m-0 text-13 text-mute">{t("kalite.noReach")}</p>;
  } else {
    const line = (row, name) => (
      <UnitRow key={row.key} t={t} row={row} name={name} on={selectedKey === row.key} onSelect={onSelect} />
    );
    body = (
      <>
        <Table caption={t("kalite.units.caption")}>
          <thead><tr>{COLUMNS.map((key) => <th key={key} scope="col">{t(key)}</th>)}</tr></thead>
          <tbody>
            {page.rows.map((row) => line(row, row.name))}
            {page.unplaced ? line(page.unplaced, t("kalite.units.unplaced")) : null}
            {line(page.total, t("kalite.units.total"))}
          </tbody>
        </Table>
        <p className="m-0 text-12 text-mute">{t("kalite.units.selectNote")}</p>
        {page.unplaced ? <p className="m-0 text-12 text-mute">{t("kalite.units.unplacedNote")}</p> : null}
      </>
    );
  }
  return (
    <Box title={t("kalite.units.title")} icon="building" level={2}>
      <div className="flex flex-col gap-2" data-units>{body}</div>
    </Box>
  );
}

/** The reasons × count: the hospital (or the scoped caller's units) and, once a row is selected, that row. */
function SnoozeBox({ t, lang, page, selection, selectionName }) {
  const columns = [{ key: TOTAL, name: t(page.scoped ? "kalite.snoozes.colScoped" : "kalite.snoozes.colHospital"),
    view: page.total.snoozes }];
  if (selection.key !== TOTAL) columns.push({ key: selection.key, name: selectionName, view: selection.snoozes });
  // A median of whole minutes may be a half: a decimal comma in az, tr and ru, a point in en.
  const minutes = (n) => (n === null ? <None />
    : t("kalite.snoozes.minutes", { n: lang === "en" ? String(n) : String(n).replace(".", ",") }));
  return (
    <Box title={t("kalite.snoozes.title")} icon="clock" level={2}>
      <div className="flex flex-col gap-2" data-snoozes>
        {page.total.snoozes.count === 0 ? <p className="m-0 text-13 text-mute">{t("kalite.snoozes.none")}</p> : (
          <Table caption={t("kalite.snoozes.caption")}>
            <thead>
              <tr>
                <th scope="col">{t("kalite.snoozes.colReason")}</th>
                {columns.map((column) => <th key={column.key} scope="col">{column.name}</th>)}
              </tr>
            </thead>
            <tbody>
              {page.total.snoozes.byReason.map(({ reason }, at) => (
                <tr key={reason}>
                  <th scope="row">{t(REASON_KEYS[reason])}</th>
                  {columns.map((column) => <td key={column.key} className="font-data">{column.view.byReason[at].n}</td>)}
                </tr>
              ))}
              <tr>
                <th scope="row">{t("kalite.snoozes.rowTotal")}</th>
                {columns.map((column) => <td key={column.key} className="font-data">{column.view.count}</td>)}
              </tr>
              <tr>
                <th scope="row">{t("kalite.snoozes.rowMedian")}</th>
                {columns.map((column) => <td key={column.key} className="font-data">{minutes(column.view.medianMinutes)}</td>)}
              </tr>
            </tbody>
          </Table>
        )}
      </div>
    </Box>
  );
}

/** The selection's alarms by kind, as the engine names its kinds. */
function KindsBox({ t, selection, selectionName }) {
  const kinds = selection.alarms.perKind;
  const time = (d) => (d ? durationText(t, d) : <None />);
  return (
    <Box title={t("kalite.kinds.title", { unit: selectionName })} icon="bell" level={2}>
      <div className="flex flex-col gap-2" data-kinds>
        {kinds.length === 0 ? <p className="m-0 text-13 text-mute">{t("kalite.kinds.none")}</p> : (
          <Table caption={t("kalite.kinds.caption")}>
            <thead><tr>{KIND_COLUMNS.map((key) => <th key={key} scope="col">{t(key)}</th>)}</tr></thead>
            <tbody>
              {kinds.map((kind) => (
                <tr key={kind.kind}>
                  <th scope="row" className="font-data">{kind.kind}</th>
                  <td className="font-data">{kind.episodes}</td>
                  <td className="font-data">{kind.answered}</td>
                  <td className="font-data">{kind.escalated}</td>
                  <td className="font-data">{kind.unanswered}</td>
                  <td className="font-data">{time(kind.median)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>
    </Box>
  );
}

export function KaliteScreen() {
  const { t, lang } = useI18n();
  const { user, store } = useSession();
  const may = Array.isArray(user?.perms) && user.perms.includes("quality.view");
  const [period, setPeriod] = useState(DEFAULT_PERIOD);
  const [selected, setSelected] = useState(TOTAL);
  const read = usePeriodRead({ store, may, period, read: readQuality, valid: isQualityAnswer });
  const page = qualityPage(readSource(read, may), period);
  const selection = selectionOf(page, selected);
  let selectionName = null;
  if (selection?.key === TOTAL) selectionName = t(page.scoped ? "kalite.snoozes.colScoped" : "kalite.snoozes.colHospital");
  else if (selection?.key === UNPLACED) selectionName = t("kalite.units.unplaced");
  else if (selection) selectionName = selection.name;
  const options = PERIODS.map((days) => ({ value: days, label: t(PERIOD_KEYS[days].label) }));
  const failed = !page.ok && page.why === WHY.failed;
  return (
    <div className="flex min-h-0 max-w-[1200px] flex-col gap-3">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="m-0 font-display text-23 font-bold">{t("kalite.title")}</h1>
          <p className="m-0 text-13 font-semibold">{t("kalite.motto")}</p>
          <p className="m-0 text-13 text-mute" data-as-of>
            {page.ok ? t("ozet.asOf", { time: hhmm(page.generatedAtMs) }) : t("kalite.noRead")}
          </p>
        </div>
        <Seg label={t("ozet.period.label")} options={options} value={period} onChange={setPeriod} />
        <Button size="sm" icon="clock" busy={may && read.phase === "loading"} onClick={read.retry}>{t("ozet.refresh")}</Button>
      </div>
      <p className="m-0 text-13 text-mute">{t("kalite.intro")}</p>
      {failed ? (
        <div data-failed>
          <Alert tone="crit">
            <p className="m-0">{read.error ? t("kalite.failed", { reason: readErrorText(t, read.error) }) : t("kalite.unreadable")}</p>
          </Alert>
        </div>
      ) : null}
      <Coverage t={t} page={page} />
      <Cards t={t} page={page} period={period} />
      <UnitsBox t={t} page={page} selectedKey={selection?.key ?? null} onSelect={setSelected} />
      {page.ok && !page.noReach ? (
        <div className="grid gap-3 lg:grid-cols-2">
          <SnoozeBox t={t} lang={lang} page={page} selection={selection} selectionName={selectionName} />
          <KindsBox t={t} selection={selection} selectionName={selectionName} />
        </div>
      ) : null}
    </div>
  );
}

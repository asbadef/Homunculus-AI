// src/live/screens/ozet/OzetScreen.jsx — G4-02 «Yönetici özeti» (spec docs/superpowers/specs/2026-11-11-g4-yonetici-ozeti-design.md,
// D5), for `summary.view`. Read-only, and no patient name or id anywhere. Top to bottom: the header (the last full read,
// «Yenile»), the four «Unutulan işler» cards, the hospital-wide alarm quality over a period, and the units as of now.
// The rules are ozet.js's; this file words them. Every number is real or a «—» with its reason (Decision 18). Nothing
// here alarms, sounds or counts on the rail.
import React, { useMemo, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { ddmmhhmm, hhmm } from "../../i18n/dates.js";
import { useSession } from "../../session/SessionProvider.jsx";
import { useBoard } from "../../data/BoardProvider.jsx";
import { useShadow } from "../../data/ShadowProvider.jsx";
import { useStructure } from "../../data/StructureProvider.jsx";
import { useSnoozeClock } from "../../data/useSnoozeClock.js";
import { readErrorText } from "../../apiErrors.js";
import { Alert, Box, Button, Icon, KV, KVList, Note, Seg, Table } from "../../ui/index.js";
import {
  DEFAULT_PERIOD, PERIODS, WHY, boardSource, dayOf, qualityView, readSource, rightsOf, shadowSource, structureSource,
  summarise,
} from "./ozet.js";
import { useQuality, useSummaryReads } from "./useSummaryReads.js";

/** Each period's switch label and the phrase the card and the box name it by. */
const PERIOD = Object.freeze({
  1: { label: "ozet.period.d1", text: "ozet.period.text1" },
  7: { label: "ozet.period.d7", text: "ozet.period.text7" },
  30: { label: "ozet.period.d30", text: "ozet.period.text30" },
});
const OCCUPANCY_EXTRAS = Object.freeze([
  ["reserved", "doluluk.counts.reserved"], ["outOfService", "doluluk.counts.outOfService"],
  ["maintenance", "doluluk.counts.maintenance"],
]);

const ageText = (t, age) => (age ? t(`ozet.age.${age.unit}`, { n: age.n }) : null);
const forText = (t, minutes) => (minutes === 0 ? t("ozet.for.underMinute") : t("ozet.for.minutes", { n: minutes }));
const durationText = (t, d) => (d.m === null ? t("ozet.q.sec", { n: d.s }) : t("ozet.q.minSec", { m: d.m, s: d.s }));

/** «—» and why: what every number that is not real is, on a card, in a cell or in the box. */
function Missing({ t, why, big = false }) {
  return (
    <span data-missing={why}>
      <span className={big ? "font-data text-23 font-bold" : "font-data font-bold"}>—</span>{" "}
      <span className="text-12 font-normal text-mute">{t(`ozet.why.${why}`)}</span>
    </span>
  );
}

function Card({ t, icon, title, what, cell, extra, atMs }) {
  return (
    <li className="flex min-w-[220px] flex-1 flex-col gap-1 rounded-box border border-line bg-card px-[14px] py-3">
      <h3 className="m-0 flex items-center gap-2 font-text text-13 font-semibold"><Icon name={icon} size={16} />{title}</h3>
      <p className="m-0" data-card-value>
        {"value" in cell ? <span className="font-data text-23 font-bold">{cell.value}</span> : <Missing t={t} why={cell.why} big />}
      </p>
      {extra ? <p className="m-0 text-13">{extra}</p> : null}
      <p className="m-0 text-12 text-mute">{what}</p>
      {"value" in cell && Number.isFinite(atMs) ? <p className="m-0 text-12 text-mute">{t("ozet.readAt", { time: hhmm(atMs) })}</p> : null}
    </li>
  );
}

function Cards({ t, cards, period, atMs }) {
  const { unanswered, pending, late, silent } = cards;
  const oldest = "value" in pending && pending.value > 0 ? ageText(t, pending.age) : null;
  let silentExtra = null;
  if ("value" in silent && silent.noMonitors) silentExtra = t("ozet.cards.silentNoMonitors");
  else if ("value" in silent && silent.value > 0 && silent.longest !== null) silentExtra = t("ozet.cards.silentLongest", { for: forText(t, silent.longest) });
  return (
    <section aria-labelledby="ozet-cards" className="flex flex-col gap-2">
      <h2 id="ozet-cards" className="m-0 font-display text-17 font-bold">{t("ozet.cards.title")}</h2>
      <ul className="m-0 flex list-none flex-wrap gap-2.5 p-0">
        <Card t={t} icon="bell" cell={unanswered} atMs={atMs.quality}
          title={t("ozet.cards.unansweredTitle", { period: t(PERIOD[period].text) })} what={t("ozet.cards.unansweredWhat")} />
        <Card t={t} icon="clip" cell={pending} atMs={atMs.pending} title={t("ozet.cards.pendingTitle")}
          what={t("ozet.cards.pendingWhat")} extra={oldest ? t("ozet.cards.pendingOldest", { age: oldest }) : null} />
        <Card t={t} icon="clock" cell={late} atMs={atMs.tasks} title={t("ozet.cards.lateTitle")} what={t("ozet.cards.lateWhat")} />
        <Card t={t} icon="plug" cell={silent} atMs={atMs.shadow} title={t("ozet.cards.silentTitle")}
          what={t("ozet.cards.silentWhat")} extra={silentExtra} />
      </ul>
    </section>
  );
}

function QualityFigures({ t, view, atMs }) {
  const figure = (value) => (value === null ? <Missing t={t} why={WHY.unknown} /> : value);
  const rate = view.answeredPct === null ? t("ozet.q.unsettled") : t("ozet.q.rate", { pct: view.answeredPct });
  const time = (d) => (d === null ? t("ozet.q.noAnswered") : durationText(t, d));
  return (
    <>
      {view.truncated ? (
        <Note tone="warn">
          {view.windowFromMs === null ? t("ozet.q.truncated") : t("ozet.q.truncatedFrom", { from: ddmmhhmm(view.windowFromMs) })}
        </Note>
      ) : null}
      <KVList>
        <KV label={t("ozet.q.episodes")}>{figure(view.episodes)}</KV>
        <KV label={t("ozet.q.answered")}>{view.answered === null ? figure(null) : `${view.answered} · ${rate}`}</KV>
        <KV label={t("ozet.q.median")}>{time(view.median)}</KV>
        <KV label={t("ozet.q.p90")}>{time(view.p90)}</KV>
        <KV label={t("ozet.q.escalated")}>{figure(view.escalated)}</KV>
        <KV label={t("ozet.q.unanswered")}>{figure(view.unanswered)}</KV>
        <KV label={t("ozet.q.pending")}>{figure(view.pending)}</KV>
      </KVList>
      {view.episodes === 0 && !view.truncated ? <p className="m-0 text-13 text-mute">{t("ozet.q.none")}</p> : null}
      {view.perDay.length > 0 ? (
        <div className="flex flex-col gap-1">
          <h3 className="m-0 font-text text-13 font-semibold">{t("ozet.q.daily")}</h3>
          <ul className="m-0 flex list-none flex-col gap-1 p-0" data-daily>
            {view.perDay.map((day) => (
              <li key={day.date} className="flex items-center gap-2 text-12.5">
                <span className="w-[120px] shrink-0 font-data">{t("ozet.q.dayCount", { date: dayOf(day.date), n: day.episodes })}</span>
                <span aria-hidden="true" className="h-2 rounded-full bg-pri" style={{ width: `${Math.max(2, Math.round(day.share * 100))}%`, maxWidth: "60%" }} />
              </li>
            ))}
          </ul>
          <p className="m-0 text-12 text-mute">{t("ozet.q.dailyNote")}</p>
        </div>
      ) : null}
      {view.perKind.length > 0 ? (
        <Table caption={t("ozet.q.byKind")}>
          <thead>
            <tr>
              <th scope="col">{t("ozet.q.colKind")}</th>
              <th scope="col">{t("ozet.q.colEpisodes")}</th>
              <th scope="col">{t("ozet.q.colAnswered")}</th>
              <th scope="col">{t("ozet.q.colEscalated")}</th>
              <th scope="col">{t("ozet.q.colMedian")}</th>
            </tr>
          </thead>
          <tbody>
            {view.perKind.map((kind) => (
              <tr key={kind.kind}>
                <th scope="row" className="font-data">{kind.kind}</th>
                <td className="font-data">{figure(kind.episodes)}</td>
                <td className="font-data">{figure(kind.answered)}</td>
                <td className="font-data">{figure(kind.escalated)}</td>
                <td className="font-data">{time(kind.median)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : null}
      {Number.isFinite(atMs) ? <p className="m-0 text-12 text-mute">{t("ozet.asOf", { time: hhmm(atMs) })}</p> : null}
    </>
  );
}

function QualityBox({ t, may, period, setPeriod, read }) {
  const source = readSource(read, may);
  let body;
  if (!may || (!source.ok && source.why === WHY.noRight)) body = <Note tone="info">{t("ozet.q.noRight")}</Note>;
  else if (read.phase === "loading") body = <p className="m-0 text-13 text-mute">{t("ozet.q.loading")}</p>;
  else if (!source.ok) {
    body = (
      <Alert tone="crit">
        <p className="m-0">{t("ozet.q.failed", { reason: read.error ? readErrorText(t, read.error) : t("ozet.why.failed") })}</p>
      </Alert>
    );
  } else body = <QualityFigures t={t} view={qualityView(read.data)} atMs={read.atMs} />;
  const options = PERIODS.map((days) => ({ value: days, label: t(PERIOD[days].label) }));
  return (
    <Box title={t("ozet.q.title")} icon="chart" level={2}
      right={may ? <Seg label={t("ozet.period.label")} options={options} value={period} onChange={setPeriod} /> : null}>
      <div className="flex flex-col gap-2" data-quality>
        <p className="m-0 text-13 text-mute">{t("ozet.q.intro", { period: t(PERIOD[period].text) })}</p>
        {body}
      </div>
    </Box>
  );
}

function occupancyText(t, counts) {
  const extras = OCCUPANCY_EXTRAS.filter(([field]) => counts[field] > 0).map(([field, key]) => t(key, { n: counts[field] }));
  return [t("doluluk.occupied", { occupied: counts.occupied, usable: counts.usable }), ...extras].join(" · ");
}

function UnitRow({ t, row, name }) {
  const cell = (c, text) => <td className="font-data">{"why" in c ? <Missing t={t} why={c.why} /> : text}</td>;
  const waiting = (c) => (c.value > 0 ? `${c.value} ${t("ozet.units.waitingSplit", { critical: c.critical, high: c.high })}` : c.value);
  const pending = (c) => (c.value > 0 && c.age ? `${c.value} · ${t("ozet.cards.pendingOldest", { age: ageText(t, c.age) })}` : c.value);
  return (
    <tr>
      <th scope="row">{name}</th>
      {row.occupancy === null ? <td /> : cell(row.occupancy, "why" in row.occupancy ? null : occupancyText(t, row.occupancy))}
      {cell(row.waiting, "value" in row.waiting ? waiting(row.waiting) : null)}
      {cell(row.late, row.late.value)}
      {cell(row.pending, "value" in row.pending ? pending(row.pending) : null)}
      {cell(row.silent, row.silent.value)}
    </tr>
  );
}

function UnitsBox({ t, summary, occupancy }) {
  let body;
  if (summary.rows === null) body = <Note tone="warn">{t("ozet.units.missing", { why: t(`ozet.why.${occupancy.why ?? WHY.failed}`) })}</Note>;
  else if (summary.rows.length === 0) body = <p className="m-0 text-13 text-mute">{t("doluluk.noUnits")}</p>;
  else {
    body = (
      <>
        <Table caption={t("ozet.units.caption")}>
          <thead>
            <tr>
              <th scope="col">{t("ozet.units.colUnit")}</th>
              <th scope="col">{t("ozet.units.colOccupancy")}</th>
              <th scope="col">{t("ozet.units.colWaiting")}</th>
              <th scope="col">{t("ozet.units.colLate")}</th>
              <th scope="col">{t("ozet.units.colPending")}</th>
              <th scope="col">{t("ozet.units.colSilent")}</th>
            </tr>
          </thead>
          <tbody>
            {summary.rows.map((row) => (
              <UnitRow key={row.key} t={t} row={row}
                name={row.closed ? `${row.name} · ${t("doluluk.unitClosed")}` : row.name} />
            ))}
            {summary.unplaced ? <UnitRow t={t} row={summary.unplaced} name={t("ozet.units.unplaced")} /> : null}
          </tbody>
        </Table>
        {summary.unplaced ? <p className="m-0 text-12 text-mute">{t("ozet.units.unplacedNote")}</p> : null}
      </>
    );
  }
  return (
    <Box title={t("ozet.units.title")} icon="building" level={2}>
      <div className="flex flex-col gap-2" data-units>{body}</div>
    </Box>
  );
}

export function OzetScreen() {
  const { t } = useI18n();
  const { user, store } = useSession();
  const board = useBoard();
  const boardNowMs = useSnoozeClock();
  const shadow = useShadow();
  const tree = useStructure();
  const rights = useMemo(() => rightsOf(user?.perms), [user?.perms]);
  const reads = useSummaryReads({ store, rights, reloadStructure: tree.reload });
  const [period, setPeriod] = useState(DEFAULT_PERIOD);
  const quality = useQuality({ store, may: rights.quality, period });

  const sources = {
    tree: tree.known ? tree.structure : null,
    occupancy: structureSource(tree, rights.structure),
    board: boardSource({ connection: board.connection, patients: board.patients, alerts: board.alerts, nowMs: boardNowMs }, rights.board),
    tasks: readSource(reads.tasks, rights.tasks),
    pending: readSource(reads.pending, rights.pending),
    shadow: shadowSource(shadow, rights.shadow),
    quality: readSource(quality, rights.quality),
  };
  const summary = summarise(sources);
  const atMs = { quality: quality.atMs, pending: reads.pending.atMs, tasks: reads.tasks.atMs, shadow: shadow.fetchedAtMs };

  return (
    <div className="flex min-h-0 max-w-[1200px] flex-col gap-3">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="m-0 font-display text-23 font-bold">{t("ozet.title")}</h1>
          <p className="m-0 text-13 text-mute" data-as-of>
            {reads.fullAt ? t("ozet.asOf", { time: hhmm(reads.fullAt) }) : t("ozet.noFullRead")}
          </p>
        </div>
        <Button size="sm" icon="clock" busy={reads.busy} onClick={reads.refresh}>{t("ozet.refresh")}</Button>
      </div>
      <p className="m-0 text-13 text-mute">{t("ozet.intro")}</p>
      <Cards t={t} cards={summary.cards} period={period} atMs={atMs} />
      <QualityBox t={t} may={rights.quality} period={period} setPeriod={setPeriod} read={quality} />
      <UnitsBox t={t} summary={summary} occupancy={sources.occupancy} />
    </div>
  );
}

// src/live/screens/beds/BedsScreen.jsx — the ward (G1-09). The prototype's "beds" screen, built on
// what the engine actually sends.
//
// Reading order on the screen, which is the order the honesty rules come in:
//   1. the connection      — an empty board whose load failed says so before anything else
//   2. the engine's scope  — why the board is this size, in the engine's own sentence
//   3. what is waiting     — the unanswered alarms, and ONLY from a LIVE board; a board that may
//                            be out of date says that instead of a reassuring "none"
//   4. the feed            — how many beds have gone quiet
//   5. the beds            — cards or a list, in bed order or risk order
//
// WHAT THIS SCREEN REFUSES TO SHOW. The prototype's board carries five "attention" tiles, two of
// which are literal constants ("3 sonuç görülmedi · laktat 4.1 dahil", "1 cihaz sessiz · RE07");
// chips for pain, fall risk and pressure-injury risk keyed off hard-coded bands; a sparkline drawn
// from a seeded random generator; and a risk level it recomputes in the browser from NEWS2. None of
// it is here. Two tiles remain, and both are built from what the engine sent.
//
// THE UNIT FILTER IS NOT REMEMBERED BETWEEN SESSIONS, ON PURPOSE. It lives where Wave 2 put the
// top bar's chip — in the shell's memory (`useShell`) — so the chip and this selector are always
// the same choice, and the choice goes when the shell does. A filter kept in this browser would
// outlive the person who set it: at a shared station the next clinician would unlock into someone
// else's narrowed ward, and a card hidden by a filter you did not set is the kind of quiet this
// screen exists to prevent. What this screen adds instead is a selector that works at 390 px
// (the chip is hidden there) and a line saying how many cards a filter is hiding, so an active
// filter can never be silent.
import React, { useEffect, useId, useMemo, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useBoard } from "../../data/BoardProvider.jsx";
import { CONNECTION } from "../../../liveConnection.js";
import { waitingAlarms } from "../../data/boardStore.js";
import { useSnoozeClock } from "../../data/useSnoozeClock.js";
import { useShell } from "../../shell/ShellContext.jsx";
import { ROUTES, canReach, screenOf } from "../../shell/routes.js";
import { useSession } from "../../session/SessionProvider.jsx";
import { readPref, writePref } from "../../prefs.js";
import { Empty, Icon, Input, RiskPill, Seg, StatusPill, Table } from "../../ui/index.js";
import { FOCUS_RING } from "../../ui/focus.js";
import { hhmm } from "../../i18n/dates.js";
import {
  BoardStrip, FeedHealth, News2, ScopeNote, boardKnown, boardStale, nameOf, summaryOf, useBoardNow,
} from "../common/BoardState.jsx";
import { elapsed } from "../common/elapsed.js";
import { hasMeasurement, lastMeasuredAt } from "../common/freshness.js";
import { measuredVitals } from "../common/vitals.js";
import { ORDERS, VIEWS, bedNameOf, inUnit, matching, norm, orderBeds } from "./order.js";
import { BedCard } from "./BedCard.jsx";
import { useUnitNames } from "../../data/StructureProvider.jsx";   // G2-B1a
import { useAdmissions } from "../kabul/useAdmissions.js";          // G2-B1a
import { boardKeyOf } from "../kabul/boardKey.js";                  // G2-B1d: the card key
import { useShadow } from "../../data/ShadowProvider.jsx";
import { MonitorFeedChip, MonitorStrip, readUnknown, stripOn } from "../common/MonitorStrip.jsx";
import { linkSentenceKey, maxAgeOf, reasonKey } from "../common/monitor.js";

/** Monitor cards whose bed label or address contains what was typed. */
const matchingMonitors = (cards, query) => {
  const q = norm(query);
  return q ? cards.filter((c) => norm(c.bed_label).includes(q) || norm(c.source).includes(q)) : cards;
};

/** Aşama A's section: monitors on no patient card of this board — the beds the table places a
 *  monitor on whose patient is not linked here, then the devices on no bed at all. After the
 *  patients, under its own heading, so no engine card is ever pushed down by a monitor. The cards
 *  are not links: there is no screen to open. */
function MonitorSection({ beds, devices, view }) {
  const { t } = useI18n();
  const id = useId();
  if (beds.length + devices.length === 0) return null;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <div>
        <h2 id={id} className="m-0 font-display text-17 font-bold">{t("monitor.section")}</h2>
        <p className="m-0 text-12.5 text-mute">{t("monitor.sectionSub")}</p>
      </div>
      <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(290px,1fr))] gap-2.5 p-0 max-[640px]:grid-cols-1">
        {beds.map((card) => {
          const why = linkSentenceKey(card);
          return (
            <li key={card.source} data-monitor="" className="rounded-box bg-card">
              <MonitorStrip entry={card} variant="compact" title={card.bed_label} {...view}>
                {why ? <p className="m-0 mt-1 text-11.5 font-semibold text-att-ink">{t(why)}</p> : null}
              </MonitorStrip>
            </li>
          );
        })}
        {devices.map((card) => (
          <li key={card.source} data-monitor="" className="rounded-box bg-card">
            <MonitorStrip entry={card} variant="compact" title={t("monitor.unassignedTitle", { source: card.source })} {...view}>
              <p className="m-0 mt-1 text-11.5 font-semibold text-att-ink">{t(reasonKey(card.reason))}</p>
              <p className="m-0 text-11.5 text-mute">{t("monitor.unassignedNote")}</p>
            </MonitorStrip>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** How often the ages on this screen are re-read. A bed card shows a measurement's clock time and
 *  a channel's overdue count, neither of which changes faster than this. */
const TICK_MS = 30_000;

/** G2-B1a (X61): the admissions still waiting for the physician's signature, for the cards' badge
 *  — the board payload carries no admission state. Read every minute while the board is open, and
 *  not at all by a session without `admissions.view` (useAdmissions). */
const DRAFT = ["DRAFT"];
const DRAFT_EVERY_MS = 60_000;

/** The alarms screen, when this build has it and this session may open it. Until G1-10 merges, the
 *  attention line states the count without linking anywhere — never a dead link. */
function alarmsHref(perms) {
  const route = ROUTES.find((r) => r.id === "alarms");
  return route && screenOf(route) && canReach(route, perms) ? `#${route.path}` : null;
}

/** What is waiting, and how sure the board is of it. The three states come from `waitingAlarms`,
 *  which has Wave 2's Decision 18 already applied: only a LIVE board may say "none". */
function Waiting({ nowMs }) {
  const { t } = useI18n();
  const { user } = useSession();
  const board = useBoard();
  // G2-B5b (spec D4): a snoozed alarm is not waiting until its `until`: the snooze clock, not this line's 30 s tick.
  const queueNowMs = useSnoozeClock();
  const { known, stale, items } = waitingAlarms({ ...board, nowMs: queueNowMs });
  const waiting = items ?? [];
  const href = alarmsHref(user?.perms);
  const oldest = waiting
    .map((a) => a.firstSeenAtMs)
    .filter((ms) => Number.isFinite(ms))
    .sort((a, b) => a - b)[0];
  let text;
  if (!known && !stale) text = t("beds.waitingUnknown");
  else if (waiting.length === 0) text = known ? t("beds.waitingNone") : t("beds.waitingUnknown");
  else text = t("beds.waiting", { count: waiting.length });
  // The prototype's attention tile (.att): an icon in a tinted square, the sentence beside it; red
  // only while something waits, so a calm ward does not wear an alarm colour.
  const hot = waiting.length > 0;
  const tile = `flex items-center rounded-box border px-4 py-3.5 ${hot ? `${CRIT_EDGE} bg-crit-soft` : "border-line bg-card"}`;
  const body = (
    <span className="flex min-w-0 items-center gap-3">
      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${hot ? "bg-crit text-white" : "bg-card2 text-mute"}`}>
        <Icon name="bell" size={19} />
      </span>
      <span className="min-w-0">
        <b className={`block text-14 ${hot ? "text-crit-ink" : ""}`}>{text}</b>
        {/* How long the oldest unanswered alarm has been open — the server's instant against this
            browser's clock, so a time that has not arrived yet reads 0:00 (elapsed.js). */}
        {Number.isFinite(oldest) ? (
          <small className="block text-11.5 text-mute">
            {t("beds.waitingOldest", { elapsed: elapsed(oldest, nowMs) })}
          </small>
        ) : null}
        {stale ? <small className="block text-11.5 text-att-ink">{t("board.degraded")}</small> : null}
      </span>
    </span>
  );
  return href ? (
    <a href={href} className={`${tile} ${FOCUS_RING}`}>{body}</a>
  ) : (
    <div className={tile}>{body}</div>
  );
}

const CRIT_EDGE = "border-[color:color-mix(in_srgb,var(--crit)_45%,transparent)]";

/** The cards under one heading per unit (the prototype's .unit-h sections), in the order they
 *  came: bed order already runs unit by unit, risk order keeps its ranking inside each unit and
 *  puts first the unit whose card ranks highest. A card with no unit goes in a last group. */
export function byUnit(list) {
  const groups = new Map();
  for (const p of list) {
    const key = p?.unitId || "";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }
  const out = [...groups].map(([unitId, items]) => ({ unitId: unitId || null, items }));
  return [...out.filter((g) => g.unitId), ...out.filter((g) => !g.unitId)];
}

/** The list view (the prototype's `table.t`). The numbers are written in `ink`, not in the
 *  channels' own colours: on `card2` — which the table's header and zebra use — `--v-map` and
 *  `--v-spo` fall under 4.5:1 in daylight (Wave 1B's contrast table).
 *  `nowMs` (G2-A2, D10): the screen's clock, for the NEWS2 cell's ages. */
function BedList({ patients, alertsOf, monitored, nowMs }) {
  const { t } = useI18n();
  return (
    <Table caption={t("beds.caption")}>
      <thead>
        <tr>
          <th>{t("beds.colBed")}</th>
          <th>{t("beds.colPatient")}</th>
          <th>{t("beds.colRisk")}</th>
          <th>{t("board.chHr")}</th>
          <th>{t("board.chSbp")}</th>
          <th>{t("board.chSpo2")}</th>
          <th>{t("board.chRr")}</th>
          <th>{t("board.chTemp")}</th>
          <th>{t("beds.colNews2")}</th>
          <th>{t("beds.colMeasured")}</th>
        </tr>
      </thead>
      <tbody>
        {patients.map((p) => {
          const measured = hasMeasurement(p.measuredAt);
          const shown = new Map(measuredVitals(p).map((v) => [v.at, v.value]));
          const cell = (key) => (shown.has(key)
            ? <span className="font-data font-bold">{shown.get(key)}</span>
            : <span className="text-mute">—<span className="sr-only">{` ${t("board.notMeasured")}`}</span></span>);
          const last = lastMeasuredAt(p.measuredAt);
          const open = alertsOf(p.patient_id).filter((a) => a.status !== "ACKNOWLEDGED");
          return (
            <tr key={p.patient_id}>
              <th scope="row" className="font-data font-bold">
                <a href={`#/patients/${encodeURIComponent(p.patient_id)}`} className={`rounded-md ${FOCUS_RING}`}>
                  {bedNameOf(p)}
                </a>
              </th>
              <td className={p.display_name ? "" : "italic text-mute"}>
                {nameOf(p, t)}
                {open.length ? <small lang="en" className="block text-11 text-mute">{summaryOf(open[0]) ?? t("board.findingUnnamed")}</small> : null}
                {/* G2-A1 (O17): outside the `lang="en"` line — the badge is the interface's own words. */}
                {open[0]?.status === "RESOLVED" ? <StatusPill tone="att">{t("alarms.resolvedUnacked")}</StatusPill> : null}
                {/* Aşama A: the list has no room for the strip, so it says where the strip is —
                    a linked monitor is never silently dropped. No value of it appears here. */}
                {monitored.has(p.patient_id) ? <small data-monitor-slot="" className="block text-11 text-mute">{t("monitor.inCards")}</small> : null}
              </td>
              <td><RiskPill risk={p.risk} measured={measured} /></td>
              <td>{cell("heart_rate")}</td>
              <td>{cell("sbp")}</td>
              <td>{cell("spo2")}</td>
              <td>{cell("resp_rate")}</td>
              <td>{cell("temperature")}</td>
              <td><News2 news2={p.news2} nowMs={nowMs} /></td>
              <td className="whitespace-nowrap font-data">{last === null ? "—" : hhmm(last)}</td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}

export function BedsScreen() {
  const { t } = useI18n();
  const board = useBoard();
  // Aşama A's unvalidated monitor strip: its own store, its own clock, read nowhere else on this
  // screen's clinical path (the waiting line, the feed chip and the cards' order are the board's).
  const shadow = useShadow();
  const { unit, setUnit, units, stale: unitsStale } = useShell();
  // G2-B1a: a unit by its name, never its UUID (data/structure.js), the names in order; a numbered
  // placeholder while the structure is not known — never «unknown».
  const names = useUnitNames(units);
  const unitName = names.nameOf;
  const drafts = useAdmissions(DRAFT, { every: DRAFT_EVERY_MS });   // G2-B1a: the badge
  const draftNumbers = useMemo(() => new Set((drafts.rows ?? []).map(boardKeyOf)), [drafts.rows]);
  const nowMs = useBoardNow(TICK_MS);
  const [view, setView] = useState(() => readPref("bedView", VIEWS, "kart"));
  const [order, setOrder] = useState(() => readPref("bedOrder", ORDERS, "yatak"));
  const [query, setQuery] = useState("");
  useEffect(() => writePref("bedView", view), [view]);
  useEffect(() => writePref("bedOrder", order), [order]);

  const all = board.patients;
  const inUnits = useMemo(() => inUnit(all, unit), [all, unit]);
  const found = useMemo(() => matching(inUnits, query), [inUnits, query]);
  const shown = useMemo(() => orderBeds(found, order), [found, order]);

  // The strip, when it is on. A bed the API links to a patient of this board goes on that
  // patient's card; every other one, and every device on no bed, goes in the section. The unit
  // filter and the search apply to both, and the "hidden" lines count them with the patients. The
  // patient cards' order, count and alarms never read any of this.
  const strip = stripOn(shadow.data) ? shadow.data : null;
  const maxAgeS = maxAgeOf(shadow.data);
  const stripView = strip ? {
    nowMs: shadow.nowMs, fetchedAtMs: shadow.fetchedAtMs, maxAgeS,
    feedOk: strip.feed?.state === "ok",
    unreadable: readUnknown(shadow, shadow.nowMs, maxAgeS),
  } : null;
  const { linked, loose } = useMemo(() => {
    const onBoard = new Set(all.map((p) => p.patient_id));
    const byPatient = new Map();
    const rest = [];
    for (const card of strip?.beds ?? []) {
      if (card.link === "one" && card.patient_id && onBoard.has(card.patient_id)) byPatient.set(card.patient_id, card);
      else rest.push(card);
    }
    return { linked: byPatient, loose: rest };
  }, [all, strip]);
  const strays = strip?.unassigned ?? [];
  const looseInUnit = unit ? loose.filter((c) => c.unit_id === unit) : loose;
  const straysInUnit = unit ? [] : strays;              // a device on no bed belongs to no unit
  const looseFound = matchingMonitors(looseInUnit, query);
  const straysFound = matchingMonitors(straysInUnit, query);

  const hiddenByUnit = all.length - inUnits.length + (loose.length - looseInUnit.length) + (strays.length - straysInUnit.length);
  const hiddenBySearch = inUnits.length - found.length + (looseInUnit.length - looseFound.length)
    + (straysInUnit.length - straysFound.length);

  const byPatient = useMemo(() => {
    const map = new Map();
    for (const a of board.alerts) {
      if (!map.has(a.patientId)) map.set(a.patientId, []);
      map.get(a.patientId).push(a);
    }
    return map;
  }, [board.alerts]);
  const alertsOf = (id) => byPatient.get(id) ?? [];
  const { user } = useSession();
  const kabulRoute = ROUTES.find((r) => r.id === "kabul");
  const kabulHref = kabulRoute && screenOf(kabulRoute) && canReach(kabulRoute, user?.perms) ? `#${kabulRoute.path}` : null;

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="m-0 font-display text-23 font-bold">{t("nav.beds")}</h1>
          {/* A count only of cards a read put on screen (live, or kept and marked out of date):
              while connecting, or after a load that failed, there are none to count, and "0 beds"
              would read as an empty ward. The unit alone is still true. */}
          {boardKnown(board.connection) || boardStale(board.connection) ? (
            <p className="m-0 text-13 text-mute">
              {unit ? t("beds.subUnit", { unit: unitName(unit), count: shown.length }) : t("beds.sub", { count: shown.length })}
            </p>
          ) : unit ? <p className="m-0 text-13 text-mute">{unitName(unit)}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Seg label={t("beds.view")} value={view} onChange={setView} options={[
            { value: "kart", label: t("beds.viewCards"), icon: "grid" },
            { value: "liste", label: t("beds.viewList"), icon: "list" },
          ]} />
          <Seg label={t("beds.order")} value={order} onChange={setOrder} options={[
            { value: "yatak", label: t("beds.orderBed"), icon: "bed" },
            { value: "risk", label: t("beds.orderRisk"), icon: "alert" },
          ]} />
          {/* The prototype's primary action on this screen, for whoever may admit. */}
          {kabulHref ? (
            <a href={kabulHref} className={`inline-flex h-9 items-center gap-1.5 rounded-ctl bg-pri px-3.5 text-13 font-bold text-onpri hover:brightness-105 ${FOCUS_RING}`}>
              <Icon name="plus" size={16} />{t("kabul.nav")}
            </a>
          ) : null}
        </div>
      </div>

      <BoardStrip connection={board.connection} />
      <ScopeNote scope={board.scope} scopeNote={board.scopeNote} />

      <div className="grid gap-3 min-[861px]:grid-cols-2">
        <Waiting nowMs={nowMs} />
        <div className="flex items-center gap-3 rounded-box border border-line bg-card px-4 py-3.5">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-card2 text-mute">
            <Icon name="activity" size={19} />
          </span>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <FeedHealth connection={board.connection} patients={all} nowMs={nowMs} />
            {/* The monitors' own chip, beside the board's and separately labelled: it speaks of the
                unvalidated strip only, and wraps under FeedHealth below 861 px. */}
            <MonitorFeedChip data={shadow.data} phase={shadow.phase} nowMs={shadow.nowMs}
              fetchedAtMs={shadow.fetchedAtMs} maxAgeS={maxAgeS} />
          </div>
        </div>
      </div>

      <div>
        <div className="flex flex-wrap items-end gap-x-3 gap-y-1">
          {/* The screen's own unit selector: the top bar's chip is hidden at 640 px and below, so
              on a phone this is the only way to choose a unit. Both write the same choice. */}
          {units.length >= 2 ? (
            <label className="flex items-center gap-2 text-12.5 font-semibold text-mute">
              <Icon name="building" size={15} />
              {/* The top bar's chip carries `shell.unitsStale` in its accessible name, and the
                  chip is hidden at 640 px and below — so on a phone the only unit control left
                  was the only one that could not say its list may be out of date. */}
              <span>{unitsStale ? `${t("beds.unit")} · ${t("shell.unitsStale")}` : t("beds.unit")}</span>
              <select
                value={unit ?? ""}
                onChange={(e) => setUnit(e.target.value || null)}
                className={`rounded-ctl border border-line2 bg-card2 px-2 py-1.5 text-12.5 text-ink ${FOCUS_RING}`}
              >
                <option value="">{t("beds.unitAll")}</option>
                {names.sorted.map((u) => <option key={u} value={u}>{unitName(u)}</option>)}
              </select>
            </label>
          ) : null}
          {/* The prototype's search field: an icon inside, the label kept for screen readers. */}
          <label className="relative block w-full max-w-[420px]">
            <span className="sr-only">{t("beds.search")}</span>
            <Icon name="search" size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mute" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} type="search" autoComplete="off"
              placeholder={t("beds.search")} className="h-10 pl-9" />
          </label>
        </div>
        {/* A filter is never silent: if something is hidden, the screen says how much. */}
        {hiddenByUnit > 0 ? <p className="m-0 mt-1.5 text-12 text-att-ink">{t("beds.unitHidden", { count: hiddenByUnit })}</p> : null}
        {hiddenBySearch > 0 ? <p className="m-0 mt-1.5 text-12 text-att-ink">{t("beds.searchHidden", { count: hiddenBySearch })}</p> : null}
      </div>

      {shown.length === 0 ? (
        <Empty icon="bed">
          {/* UNAVAILABLE is not CONNECTING. The last branch said "the board is loading" for
              both, directly under a crit strip saying there is no connection to the server and
              the list is not shown — one of the two had to be wrong, and the reassuring one was.
              Each state now says its own sentence. */}
          {query && inUnits.length > 0 ? t("beds.searchNone", { query })
            : boardKnown(board.connection) ? t("beds.emptyLive")
              : boardStale(board.connection) ? t("board.degraded")
                : board.connection === CONNECTION.UNAVAILABLE ? t("board.unavailable")
                  : t("board.connecting")}
        </Empty>
      ) : view === "liste" ? (
        <BedList patients={shown} alertsOf={alertsOf} monitored={linked} nowMs={nowMs} />
      ) : (
        byUnit(shown).map((group, _i, groups) => (
          <section key={group.unitId ?? "-"} aria-label={group.unitId ? unitName(group.unitId) : t("beds.noUnitGroup")} className="flex flex-col gap-2.5">
            <div className="flex flex-wrap items-baseline justify-between gap-2 pt-1">
              <h2 className="m-0 font-display text-15 font-bold">{group.unitId ? unitName(group.unitId) : t("beds.noUnitGroup")}</h2>
              {/* With one unit the page's own count already says it. */}
              {groups.length > 1 ? <span className="text-12 text-mute">{t("beds.sub", { count: group.items.length })}</span> : null}
            </div>
            <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(290px,1fr))] gap-2.5 p-0 max-[640px]:grid-cols-1">
              {group.items.map((p) => (
                <BedCard key={p.patient_id} patient={p} alerts={alertsOf(p.patient_id)} nowMs={nowMs} connection={board.connection}
                  monitor={linked.has(p.patient_id) ? { entry: linked.get(p.patient_id), ...stripView } : undefined}
                  draft={draftNumbers.has(p.patient_id)} />
              ))}
            </ul>
          </section>
        ))
      )}
      {order === "yatak" ? <p className="m-0 text-11.5 text-mute">{t("beds.orderNote")}</p> : null}
      {strip ? <MonitorSection beds={looseFound} devices={straysFound} view={stripView} /> : null}
    </div>
  );
}

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
import React, { useEffect, useMemo, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useBoard } from "../../data/BoardProvider.jsx";
import { CONNECTION } from "../../../liveConnection.js";
import { waitingAlarms } from "../../data/boardStore.js";
import { useShell } from "../../shell/ShellContext.jsx";
import { ROUTES, canReach, screenOf } from "../../shell/routes.js";
import { useSession } from "../../session/SessionProvider.jsx";
import { readPref, writePref } from "../../prefs.js";
import { Box, Empty, Field, Icon, Input, RiskPill, Seg, Table } from "../../ui/index.js";
import { FOCUS_RING } from "../../ui/focus.js";
import { hhmm } from "../../i18n/dates.js";
import {
  BoardStrip, FeedHealth, News2, ScopeNote, boardKnown, boardStale, nameOf, summaryOf, useBoardNow,
} from "../common/BoardState.jsx";
import { elapsed } from "../common/elapsed.js";
import { hasMeasurement, lastMeasuredAt } from "../common/freshness.js";
import { measuredVitals } from "../common/vitals.js";
import { ORDERS, VIEWS, bedNameOf, inUnit, matching, orderBeds } from "./order.js";
import { BedCard } from "./BedCard.jsx";
import { useShadow } from "../../data/ShadowProvider.jsx";
import { MonitorFeedChip } from "../common/MonitorStrip.jsx";

/** How often the ages on this screen are re-read. A bed card shows a measurement's clock time and
 *  a channel's overdue count, neither of which changes faster than this. */
const TICK_MS = 30_000;

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
  const { known, stale, items } = waitingAlarms(board);
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
  const body = (
    <span className="flex min-w-0 items-center gap-2">
      <Icon name="bell" size={16} className={waiting.length ? "text-crit" : "text-mute"} />
      <span className="min-w-0">
        <b className="block text-13">{text}</b>
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
    <a href={href} className={`rounded-box border border-line bg-card px-3 py-2.5 ${FOCUS_RING}`}>{body}</a>
  ) : (
    <div className="rounded-box border border-line bg-card px-3 py-2.5">{body}</div>
  );
}

/** The list view (the prototype's `table.t`). The numbers are written in `ink`, not in the
 *  channels' own colours: on `card2` — which the table's header and zebra use — `--v-map` and
 *  `--v-spo` fall under 4.5:1 in daylight (Wave 1B's contrast table). */
function BedList({ patients, alertsOf }) {
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
              </td>
              <td><RiskPill risk={p.risk} measured={measured} /></td>
              <td>{cell("heart_rate")}</td>
              <td>{cell("sbp")}</td>
              <td>{cell("spo2")}</td>
              <td>{cell("resp_rate")}</td>
              <td>{cell("temperature")}</td>
              <td><News2 news2={p.news2} /></td>
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
  const hiddenByUnit = all.length - inUnits.length;
  const hiddenBySearch = inUnits.length - found.length;

  const byPatient = useMemo(() => {
    const map = new Map();
    for (const a of board.alerts) {
      if (!map.has(a.patientId)) map.set(a.patientId, []);
      map.get(a.patientId).push(a);
    }
    return map;
  }, [board.alerts]);
  const alertsOf = (id) => byPatient.get(id) ?? [];

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
              {unit ? t("beds.subUnit", { unit, count: shown.length }) : t("beds.sub", { count: shown.length })}
            </p>
          ) : unit ? <p className="m-0 text-13 text-mute">{unit}</p> : null}
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
        </div>
      </div>

      <BoardStrip connection={board.connection} />
      <ScopeNote scope={board.scope} scopeNote={board.scopeNote} />

      <div className="grid gap-2 min-[861px]:grid-cols-2">
        <Waiting nowMs={nowMs} />
        <div className="flex flex-wrap items-center gap-2 rounded-box border border-line bg-card px-3 py-2.5">
          <FeedHealth connection={board.connection} patients={all} nowMs={nowMs} />
          {/* The monitors' own chip, beside the board's and separately labelled: it speaks of the
              unvalidated strip only, and wraps under FeedHealth below 861 px. */}
          <MonitorFeedChip data={shadow.data} phase={shadow.phase} />
        </div>
      </div>

      <Box className="!px-3 !py-2.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
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
                className={`rounded-ctl border border-line2 bg-card2 px-2 py-1.5 font-data text-12.5 text-ink ${FOCUS_RING}`}
              >
                <option value="">{t("beds.unitAll")}</option>
                {units.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </label>
          ) : null}
          <Field label={t("beds.search")} layout="col" className="!mb-0 min-w-[200px] flex-1">
            <Input value={query} onChange={(e) => setQuery(e.target.value)} type="search" autoComplete="off" />
          </Field>
        </div>
        {/* A filter is never silent: if something is hidden, the screen says how much. */}
        {hiddenByUnit > 0 ? <p className="m-0 mt-1.5 text-12 text-att-ink">{t("beds.unitHidden", { count: hiddenByUnit })}</p> : null}
        {hiddenBySearch > 0 ? <p className="m-0 mt-1.5 text-12 text-att-ink">{t("beds.searchHidden", { count: hiddenBySearch })}</p> : null}
      </Box>

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
        <BedList patients={shown} alertsOf={alertsOf} />
      ) : (
        <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(290px,1fr))] gap-2.5 p-0 max-[640px]:grid-cols-1">
          {shown.map((p) => (
            <BedCard key={p.patient_id} patient={p} alerts={alertsOf(p.patient_id)} nowMs={nowMs} connection={board.connection} />
          ))}
        </ul>
      )}
      {order === "yatak" ? <p className="m-0 text-11.5 text-mute">{t("beds.orderNote")}</p> : null}
    </div>
  );
}

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
import { Empty, Icon, RiskPill, Seg, StatusPill, riskStyle } from "../../ui/index.js";
import { FOCUS_RING } from "../../ui/focus.js";
import { ddmm, hhmm } from "../../i18n/dates.js";
import {
  BoardStrip, FeedHealth, ScopeNote, boardKnown, boardStale, nameOf, useBoardNow,
} from "../common/BoardState.jsx";
import { elapsed } from "../common/elapsed.js";
import { hasMeasurement, lastMeasuredAt } from "../common/freshness.js";
import { VITALS, measuredVitals } from "../common/vitals.js";
import { ORDERS, VIEWS, bedNameOf, inUnit, orderBeds } from "./order.js";
import { AgeSex, BedCard, CardFlag, MonitorValue, monitorValues, toneText } from "./BedCard.jsx";
import { AttentionTiles, lateByPatient, useTaskQueue } from "./AttentionTiles.jsx";
import { ageText } from "../patient/ageText.js";
import { useStructure, useUnitNames } from "../../data/StructureProvider.jsx";   // G2-B1a
import { BED_STATE_KEYS, CARE_TIER_KEYS, UNIT_TYPE_KEYS, floorText, normId } from "../../data/structure.js";
import { useAdmissions } from "../kabul/useAdmissions.js";          // G2-B1a
import { boardKeyOf } from "../kabul/boardKey.js";                  // G2-B1d: the card key
import { useShadow } from "../../data/ShadowProvider.jsx";
import { MonitorFeedChip, MonitorStrip, readUnknown, stripOn } from "../common/MonitorStrip.jsx";
import { linkSentenceKey, maxAgeOf, reasonKey } from "../common/monitor.js";

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

/** A unit's beds from the hospital's own structure (Yönetim → Yapı), active ones only, in label
 *  order; [] while the structure is not known — the board never invents a bed. */
export function unitBeds(index, unitId) {
  if (!unitId) return [];
  const key = normId(unitId);
  return [...index.beds.values()]
    .filter((b) => normId(b.unitId) === key && b.isActive)
    .sort((a, b) => String(a.label).localeCompare(String(b.label), "en", { numeric: true, sensitivity: "base" }));
}

/** How a bed that holds no patient looks, by its state in the structure: the word's colour (the
 *  prototype's .bed.empty — green «Boş», amber «Temizlikte», blue «Rezerve»), and whether a patient
 *  may be placed. A state this build does not know is drawn in the attention ink, not a quiet one. */
const FREE_LOOK = Object.freeze({
  AVAILABLE: "text-ok", HOUSEKEEPING: "text-mid-ink", RESERVED: "text-low-ink",
  MAINTENANCE: "text-mute", BLOCKED: "text-mute", PENDING_TRANSFER_OUT: "text-att-ink", PENDING_DISCHARGE: "text-att-ink",
});

/** The prototype's bed card with no patient on it (.bed.empty): the bed and its state, its room and
 *  since when, and «Hasta ata» on a free bed for whoever may admit. Every word is the structure's. */
function FreeBed({ bed, kabulHref }) {
  const { t } = useI18n();
  const free = bed.open && bed.state === "AVAILABLE";
  const since = Date.parse(bed.stateSince);
  const note = free ? t("beds.emptyAssignable")
    : !bed.open ? t("kabul.bedClosed")
      : Number.isFinite(since) ? t("beds.stateSince", { date: ddmm(since), time: hhmm(since) }) : null;
  return (
    <li className="relative overflow-hidden rounded-[14px] border border-line bg-card pb-[11px] pl-[18px] pr-3.5 pt-3 opacity-60">
      <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1 bg-line2" />
      <div className="inline-block max-w-full">
        <p className="m-0 text-center leading-[normal]">
          <b className={`mr-1.5 font-data text-15 font-bold ${FREE_LOOK[bed.state] ?? "text-att-ink"}`}>{bed.label}</b>
          <span className="font-display text-15 font-bold text-mute">{t(BED_STATE_KEYS[bed.state] ?? "kabul.bedOther")}</span>
        </p>
        <span className="block text-12 leading-[18px] text-mute">{[bed.roomName, note].filter(Boolean).join(" · ")}</span>
      </div>
      {free && kabulHref ? (
        <div className="mt-2.5 text-center">
          <a href={kabulHref} className={`inline-flex h-7 items-center gap-1.5 rounded-[10px] border border-line2 bg-card px-[9px] text-12 font-semibold leading-[normal] text-ink hover:border-pri ${FOCUS_RING}`}>
            <Icon name="plus" size={16} />{t("beds.assign")}
          </a>
        </div>
      ) : null}
    </li>
  );
}

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

/** The prototype shows every unit of the hospital, an empty one too («Anjiyografi · 0 / 3 dolu»).
 *  `groups` (byUnit) gains, after its own, each active unit of the structure that has no card —
 *  only units this session may see (`scope`, the engine's list; all when it sent none) and only the
 *  chosen one under a unit filter. The group without a unit stays last. */
export function withEmptyUnits(groups, index, scope = [], chosen = null) {
  const seen = new Set(groups.map((g) => normId(g.unitId)));
  const allowed = new Set(scope.map(normId));
  const extra = [...index.units.values()]
    .filter((u) => u.isActive && !seen.has(normId(u.id)))
    .filter((u) => (chosen ? normId(u.id) === normId(chosen) : allowed.size === 0 || allowed.has(normId(u.id))))
    .map((u) => ({ unitId: u.id, items: [] }));
  return [...groups.filter((g) => g.unitId), ...extra, ...groups.filter((g) => !g.unitId)];
}

// The list's numeric columns: the board's channel, the prototype's header, the monitor's value
// (monitorValues), the channel's colour.
const TRAIL_POINTS = 120;

const LIST_COLS = [
  ["heart_rate", "HR", "heart_rate"], ["sbp", null, "bp"], ["spo2", "SpO₂", "spo2"],
  ["resp_rate", "RR", "resp_rate"], ["temperature", null, "temperature"],
];

/** One unit's list — the prototype's `table.t` row for row (screens.js `beds`, app.css `table.t`):
 *  bed (td.n, the risk colour), patient (name; age, sex · diagnoses), state, HR, KB, SpO₂, RR, Isı
 *  (td.n, right-aligned, the channel colour), score (scoreLabel), flags; then each empty bed with
 *  its state alone. The whole row opens the patient. A channel the validated record lacks takes the
 *  monitor's value, marked M and kept out of what the row says (as on the card). */
function BedList({ patients, free, alertsOf, monitorOf, lateOf, draftOf }) {
  const { t } = useI18n();
  const meta = new Map(VITALS.map((v) => [v.at, v]));
  const th = "whitespace-nowrap border-b border-line bg-card2 px-3 py-2.5 text-left text-10.5 font-bold uppercase leading-[normal] tracking-[.08em] text-mute";
  const td = "border-b border-line px-3 py-[9px] align-middle group-last:border-b-0";
  const num = `${td} whitespace-nowrap text-right font-data text-13.5 font-bold`;
  const heads = [t("beds.colBed"), t("beds.colPatient"), t("beds.colRisk"), "HR", t("beds.colBp"), "SpO₂", "RR", t("beds.tempShort"), t("beds.colNews2"), t("beds.colAlarms")];
  const open = (id) => { window.location.hash = `#/patients/${encodeURIComponent(id)}`; };
  return (
    <div className="overflow-x-auto rounded-[14px] border border-line bg-card">
      <table aria-label={t("beds.caption")} className="w-full border-collapse text-13">
        <thead><tr>{heads.map((h, i) => <th key={h} scope="col" className={`${th} ${i >= 3 && i <= 7 ? "!text-right" : ""}`}>{h}</th>)}</tr></thead>
        <tbody>
          {patients.map((p) => {
            const measured = hasMeasurement(p.measuredAt);
            const tone = riskStyle(p.risk, { measured }).tone;
            const shown = new Map(measuredVitals(p).map((v) => [v.at, v.value]));
            const mon = monitorValues(monitorOf(p.patient_id));
            const alarms = alertsOf(p.patient_id).filter((a) => a.status !== "ACKNOWLEDGED");
            const late = lateOf(p.patient_id);
            const news2 = typeof p.news2?.total === "number" ? p.news2 : null;
            const score = [news2 ? `${t("board.news2")} ${news2.total}` : null, Number.isFinite(p.sofa) ? `SOFA ${p.sofa}` : null].filter(Boolean).join(" · ");
            return (
              <tr key={p.patient_id} className="group cursor-pointer hover:[&>*]:bg-card2" onClick={() => open(p.patient_id)}>
                <th scope="row" className={`${num} ${toneText(tone)}`}>
                  <a href={`#/patients/${encodeURIComponent(p.patient_id)}`} className={`rounded-md ${FOCUS_RING}`} onClick={(e) => e.stopPropagation()}>
                    {bedNameOf(p)}
                  </a>
                </th>
                <td className={td}>
                  <b className={p.display_name ? "text-ink" : "italic text-mute"}>{nameOf(p, t)}</b>
                  <div className="text-11.5 text-mute [&>span]:!text-11.5 [&>span]:!leading-normal"><AgeSex patient={p} /></div>
                  {/* G2-A1 (O17): a critical that passed unacknowledged is drawn on a calm row; the badge says why. */}
                  {alarms[0]?.status === "RESOLVED" ? <StatusPill tone="att">{t("alarms.resolvedUnacked")}</StatusPill> : null}
                </td>
                <td className={td}><RiskPill risk={p.risk} measured={measured} /></td>
                {LIST_COLS.map(([key, , monKey]) => (
                  <td key={key} className={`${num} ${meta.get(key)?.color ?? "text-ink"}`}>
                    {shown.has(key) ? shown.get(key) : (
                      <>
                        {mon[monKey] ? <MonitorValue value={mon[monKey]} t={t} /> : null}
                        <span className="text-mute [[data-monitor-value]+&]:hidden">—<span className="sr-only">{` ${t("board.notMeasured")}`}</span></span>
                      </>
                    )}
                  </td>
                ))}
                <td className={`${td} whitespace-nowrap`}>
                  {score || t("beds.noScore")}{news2?.partial ? ` · ${t("board.news2Partial").toLocaleLowerCase()}` : ""}
                </td>
                <td className={td}>
                  <span className="flex flex-wrap gap-1">
                    {draftOf(p.patient_id) ? <CardFlag>{t("kabul.badgeDraft")}</CardFlag> : null}
                    {alarms.length ? <CardFlag tone="crit">{t("beds.flagAlarms", { count: alarms.length })}</CardFlag> : null}
                    {late ? <CardFlag tone="crit">{t("beds.flagLate", { count: late })}</CardFlag> : null}
                  </span>
                </td>
              </tr>
            );
          })}
          {free.map((b) => (
            <tr key={b.id} className="group">
              <th scope="row" className={`${num} font-normal text-mute`}>{b.label}</th>
              <td colSpan={9} className={`${td} text-mute`}>{t(BED_STATE_KEYS[b.state] ?? "kabul.bedOther")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
  const structure = useStructure();
  const wardBeds = [...structure.index.beds.values()].filter((b) => b.isActive && (!unit || normId(b.unitId) === normId(unit)));
  const wardUnits = new Set(wardBeds.map((b) => normId(b.unitId))).size;
  const unitName = names.nameOf;
  const drafts = useAdmissions(DRAFT, { every: DRAFT_EVERY_MS });   // G2-B1a: the badge
  const draftNumbers = useMemo(() => new Set((drafts.rows ?? []).map(boardKeyOf)), [drafts.rows]);
  const nowMs = useBoardNow(TICK_MS);
  const [view, setView] = useState(() => readPref("bedView", VIEWS, "kart"));
  const [order, setOrder] = useState(() => readPref("bedOrder", ORDERS, "yatak"));
  useEffect(() => writePref("bedView", view), [view]);
  useEffect(() => writePref("bedOrder", order), [order]);

  const all = board.patients;
  const inUnits = useMemo(() => inUnit(all, unit), [all, unit]);
  const found = inUnits;
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
  // The monitor's heart rate per linked patient, one point per strip read while the board is
  // open: the card's line when the engine has no trend yet. Kept here only, never sent or read.
  const [trails, setTrails] = useState(() => new Map());
  useEffect(() => {
    if (!stripView || !shadow.fetchedAtMs) return;
    setTrails((prev) => {
      const next = new Map(prev);
      for (const [id, entry] of linked) {
        const hr = Number(monitorValues({ entry, ...stripView }).heart_rate);
        if (!Number.isFinite(hr)) continue;
        const pts = next.get(id) ?? [];
        if (pts.at(-1)?.ms === shadow.fetchedAtMs) continue;
        next.set(id, [...pts, { ms: shadow.fetchedAtMs, value: hr }].slice(-TRAIL_POINTS));
      }
      return next;
    });
  }, [shadow.fetchedAtMs]); // eslint-disable-line react-hooks/exhaustive-deps
  const looseInUnit = unit ? loose.filter((c) => c.unit_id === unit) : loose;
  const straysInUnit = unit ? [] : strays;              // a device on no bed belongs to no unit
  const looseFound = looseInUnit;
  const straysFound = straysInUnit;

  const hiddenByUnit = all.length - inUnits.length + (loose.length - looseInUnit.length) + (strays.length - straysInUnit.length);

  const byPatient = useMemo(() => {
    const map = new Map();
    for (const a of board.alerts) {
      if (!map.has(a.patientId)) map.set(a.patientId, []);
      map.get(a.patientId).push(a);
    }
    return map;
  }, [board.alerts]);
  const alertsOf = (id) => byPatient.get(id) ?? [];
  const tasks = useTaskQueue();
  const lateBy = useMemo(() => lateByPatient(tasks, nowMs), [tasks, nowMs]);
  // The prototype's «son veri 2 sn önce»: the newest reading on the board, aged on the board's clock.
  const newest = all.map((p) => lastMeasuredAt(p.measuredAt)).filter((ms) => ms !== null).sort((a, b) => b - a)[0];
  const newestAge = Number.isFinite(newest) ? ageText(t, new Date(newest).toISOString(), nowMs) : null;
  const { user } = useSession();
  const kabulRoute = ROUTES.find((r) => r.id === "kabul");
  const kabulHref = kabulRoute && screenOf(kabulRoute) && canReach(kabulRoute, user?.perms) ? `#${kabulRoute.path}` : null;

  return (
    <div className="flex min-h-0 flex-col">
      {/* The prototype's .ph: the title 23 px, its line 13 px under it, the tools at the right. */}
      <div className="mb-3.5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="m-0 font-display text-23 font-bold leading-[1.1]">{t("nav.beds")}</h1>
          {/* A count only of cards a read put on screen (live, or kept and marked out of date):
              while connecting, or after a load that failed, there are none to count, and "0 beds"
              would read as an empty ward. The unit alone is still true. */}
          {boardKnown(board.connection) || boardStale(board.connection) ? (
            <p className="m-0 mt-1 text-13 text-mute">
              {/* «15 birim · 24 / 94 dolu · son veri 2 sn önce»: from the hospital's own structure when
                  it is known; the cards' count until then. */}
              {wardBeds.length ? (
                <span>{`${unit ? `${unitName(unit)} · ` : ""}${t("beds.subUnits", { count: wardUnits })} · ${t("beds.unitFill", { occupied: wardBeds.filter((b) => b.state === "OCCUPIED").length, total: wardBeds.length })}`}</span>
              ) : (
                <span>{unit ? t("beds.subUnit", { unit: unitName(unit), count: shown.length }) : t("beds.sub", { count: shown.length })}</span>
              )}
              {newestAge ? <span>{` · ${t("beds.lastData", { age: newestAge })}`}</span> : null}
            </p>
          ) : unit ? <p className="m-0 mt-1 text-13 text-mute">{unitName(unit)}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* The order switch (G1-09) keeps its two named buttons here for the keyboard and a screen
              reader — drawn once it has the focus; the pointer's copy is the words in each unit's line,
              as the prototype writes them («risk sırasına göre»). */}
          <Seg className="sr-only focus-within:not-sr-only" label={t("beds.order")} value={order} onChange={setOrder} options={[
            { value: "yatak", label: t("beds.orderBed") },
            { value: "risk", label: t("beds.orderRisk") },
          ]} />
          <Seg label={t("beds.view")} value={view} onChange={setView} options={[
            { value: "kart", label: t("beds.viewCards") },
            { value: "liste", label: t("beds.viewList") },
          ]} />
          {/* The prototype's primary action on this screen (.btn.p), for whoever may admit. */}
          {kabulHref ? (
            <a href={kabulHref} className={`inline-flex h-[34px] items-center gap-1.5 rounded-[10px] bg-pri px-[13px] text-13 font-semibold leading-[normal] text-onpri hover:brightness-105 ${FOCUS_RING}`}>
              <Icon name="plus" size={16} />{t("beds.admit")}
            </a>
          ) : null}
        </div>
      </div>

      <div className="mb-3 flex flex-col gap-3 empty:hidden">
        <BoardStrip connection={board.connection} />
        <ScopeNote scope={board.scope} scopeNote={board.scopeNote} />
      </div>

      <AttentionTiles nowMs={nowMs} tasks={tasks} />
      <div data-feed-row="" className="mt-2.5 flex min-w-0 flex-wrap items-center gap-2 empty:hidden">
        <FeedHealth connection={board.connection} patients={all} nowMs={nowMs} />
        {/* The monitors' own chip, beside the board's and separately labelled: it speaks of the
            unvalidated strip only. */}
        <MonitorFeedChip data={shadow.data} phase={shadow.phase} nowMs={shadow.nowMs}
          fetchedAtMs={shadow.fetchedAtMs} maxAgeS={maxAgeS} />
      </div>

      <div className="empty:hidden">
        <div className="mt-2.5 flex flex-wrap items-end gap-x-3 gap-y-1 empty:hidden">
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
        </div>
        {/* A filter is never silent: if something is hidden, the screen says how much. */}
        {hiddenByUnit > 0 ? <p className="m-0 mt-1.5 text-12 text-att-ink">{t("beds.unitHidden", { count: hiddenByUnit })}</p> : null}
      </div>

      {shown.length === 0 ? (
        <Empty icon="bed" className="mt-4">
          {/* UNAVAILABLE is not CONNECTING. The last branch said "the board is loading" for
              both, directly under a crit strip saying there is no connection to the server and
              the list is not shown — one of the two had to be wrong, and the reassuring one was.
              Each state now says its own sentence. */}
          {boardKnown(board.connection) ? t("beds.emptyLive")
              : boardStale(board.connection) ? t("board.degraded")
                : board.connection === CONNECTION.UNAVAILABLE ? t("board.unavailable")
                  : t("board.connecting")}
        </Empty>
      ) : (
        withEmptyUnits(byUnit(shown), structure.index, units, unit).map((group, _i, groups) => {
          const beds = unitBeds(structure.index, group.unitId);
          const occupied = beds.filter((b) => b.state === "OCCUPIED").length;
          // Every bed of the unit that holds no patient: free ones first, then the others by label.
          const free = beds.filter((b) => b.state !== "OCCUPIED")
            .sort((x, y) => Number(y.open && y.state === "AVAILABLE") - Number(x.open && x.state === "AVAILABLE"));
          const info = structure.index.units.get(normId(group.unitId));
          // The prototype's pills: the kind, the floor, what the unit is followed for and its score rule.
          const pills = info ? [
            UNIT_TYPE_KEYS[info.unitType] ? t(UNIT_TYPE_KEYS[info.unitType]) : null,
            info.floor === null ? null : floorText(t, info.floor),
            [info.careTier && CARE_TIER_KEYS[info.careTier] ? t(CARE_TIER_KEYS[info.careTier]) : null, info.scoreRule].filter(Boolean).join(" · ") || null,
          ].filter(Boolean) : [];
          return (
            <section key={group.unitId ?? "-"} aria-label={group.unitId ? unitName(group.unitId) : t("beds.noUnitGroup")}>
              {/* The prototype's .sec: the unit 14 px, its pills, and at the right how full it is and
                  the order — which is the order switch itself (bed order / risk order, G1-09). */}
              <div className="mb-2.5 mt-[18px] flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                <h2 className="m-0 font-display text-14 font-bold leading-[normal]">{group.unitId ? unitName(group.unitId) : t("beds.noUnitGroup")}</h2>
                {pills.map((p) => <span key={p} className="rounded-full bg-card2 px-2 py-[3px] text-11.5 font-semibold leading-[normal] text-mute">{p}</span>)}
                <small className="ml-auto text-12 font-medium leading-[normal] text-mute">
                  {beds.length ? `${t("beds.unitFill", { occupied, total: beds.length })} · `
                    : groups.length > 1 ? `${t("beds.sub", { count: group.items.length })} · ` : null}
                  <button type="button" aria-hidden="true" tabIndex={-1} title={t("beds.order")}
                    onClick={() => setOrder(order === "risk" ? "yatak" : "risk")}
                    className={`rounded font-medium text-mute underline decoration-dotted underline-offset-2 hover:text-ink ${FOCUS_RING}`}>
                    {t(order === "risk" ? "beds.byRisk" : "beds.byBed")}
                  </button>
                </small>
              </div>
              {view === "liste" ? (
                <BedList patients={group.items} free={free} alertsOf={alertsOf}
                  monitorOf={(id) => (linked.has(id) ? { entry: linked.get(id), ...stripView } : undefined)}
                  lateOf={(id) => lateBy.get(id) ?? 0} draftOf={(id) => draftNumbers.has(id)} />
              ) : (
                <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(290px,1fr))] gap-3 p-0 max-[640px]:grid-cols-1">
                  {group.items.map((p) => (
                    <BedCard key={p.patient_id} patient={p} alerts={alertsOf(p.patient_id)} nowMs={nowMs} connection={board.connection}
                      monitor={linked.has(p.patient_id) ? { entry: linked.get(p.patient_id), ...stripView } : undefined}
                      draft={draftNumbers.has(p.patient_id)} spark lateTasks={lateBy.get(p.patient_id) ?? 0} trail={trails.get(p.patient_id)} />
                  ))}
                  {free.map((b) => <FreeBed key={b.id} bed={b} kabulHref={kabulHref} />)}
                </ul>
              )}
            </section>
          );
        })
      )}
      {order === "yatak" ? <p className="m-0 mt-3 text-11.5 text-mute">{t("beds.orderNote")}</p> : null}
      {strip ? <div className="mt-4 empty:hidden"><MonitorSection beds={looseFound} devices={straysFound} view={stripView} /></div> : null}
    </div>
  );
}

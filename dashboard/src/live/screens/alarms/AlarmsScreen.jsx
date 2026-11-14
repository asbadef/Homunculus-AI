// src/live/screens/alarms/AlarmsScreen.jsx — the open alarms (G1-10).
//
// TWO SECTIONS, NOT THREE. The prototype has "awaiting response", "under review" and "closed in
// the last hour". The first two are the board's own two states (`acknowledged` false and true).
// The third cannot be built: `/patients` carries the engine's ACTIVE alarms only, so a closed
// alarm simply leaves the board, and the only durable record of it is the audit trail — which
// needs `audit.view`, which no nurse has, and whose reads return the OLDEST rows first (a known
// engine defect, roadmap "Dalga 0'dan açık kalanlar"). An empty "closed today" section would read
// as "nothing was closed today", which is a different and false statement. So the screen says in
// one sentence where a closed alarm went, and shows two sections. Since G2-A1 one kind of alarm
// stays although its condition passed: a critical nobody acknowledged (status RESOLVED). It waits
// in the first section, with a badge, until someone acknowledges it — which removes it.
//
// ONE ESCALATION FACT, NOT A LADDER. The prototype draws three pills — 3 / 5 / 10 minutes,
// charge nurse / physician / rapid-response — and advances them when a human clicks "Escalate".
// Nothing behind the live API has that shape: the board carries one boolean, `escalated`, which
// the engine's own escalation loop sets. The prototype's own admin screen admits the chain is "in
// the engine's code but not connected". So: the engine's flag, named, with one sentence saying
// whose business escalation is. Manual escalation is «RRT çağır» (G2-B5); snooze is «Ertele» (G2-B5b), below.
//
// THE AGE IS THE SERVER'S INSTANT ON THIS BROWSER'S CLOCK. `firstSeenAtMs` with `elapsed()`:
// `m:ss` under an hour, `h:mm:ss` above (never "318:30"), `0:00` for an instant that has not
// arrived, and NO duration at all when the engine sent no first-seen time — never an invented one.
// Nothing runs on the simulation's clock, which is gone.
//
// «RRT ÇAĞIR» (G2-B5, spec D8). A holder of `alerts.escalate` may call the rapid-response team to an alarm that
// waits for an answer and has no call yet, with a reason (RrtCallDialog). The call is not an answer: the alarm
// stays where it is, still asking for «Gördüm», and its row says who called the team and when — the
// acknowledgement ends the call (spec D4). One dialog for the screen: `callFor`, the alarm it is open for, or null.
//
// «ERTELE» (G2-B5b, spec D4). A holder of `alerts.ack` may snooze an unanswered high or moderate alarm (SnoozeDialog),
// within the owner's caps and with a named reason.
//   - A snoozed alarm moves to «Ertelenenler» until its `until`, by this screen's clock, and comes back to the
//     waiting on its own. Its row says until when, by whom and why.
//   - A critical alarm is never snoozed, and the screen says so once, beside the first critical alarm that waits.
//   - One dialog: `snoozeFor`.
import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useBoard } from "../../data/BoardProvider.jsx";
import { SEVERITY_ORDER } from "../../data/boardStore.js";
import { isSnoozed, maySnooze } from "../../data/snooze.js";
import { useSession } from "../../session/SessionProvider.jsx";
import { apiErrorText } from "../../apiErrors.js";
import { Alert, Announce, Box, Button, Empty, Icon, Note, RiskPill, Seg, StatusPill, riskStyle, useToast } from "../../ui/index.js";
import { useUnitNames } from "../../data/StructureProvider.jsx";
import { FOCUS_RING } from "../../ui/focus.js";
import { hhmm } from "../../i18n/dates.js";
import {
  BoardStrip, ChronicExpected, ScopeNote, boardKnown, boardStale, pillRisk, railOf, summaryOf, useBoardNow,
} from "../common/BoardState.jsx";
import { elapsed } from "../common/elapsed.js";
import { RrtCallDialog } from "../rrt/RrtCallDialog.jsx";
import { SnoozeDialog, snoozeReasonText } from "./SnoozeDialog.jsx";

/** The ages on this screen tick every second: how long an alarm nobody has answered has been open
 *  is the number this screen exists to show. `useNow` skips the tick while the tab is hidden. */
const TICK_MS = 1_000;

/** Oldest first, and a severity this build does not know first of all — it may be the worst (the
 *  rule `waitingAlarms` follows for the bell).
 *
 *  The order is `SEVERITY_ORDER`, imported from `data/boardStore.js` where the bell and the rail
 *  badge read it (`waitingAlarms`), rather than a second copy written out here — a level the
 *  engine gained would have been missing from the copy and this screen would have ordered the
 *  ward differently from the bell beside it.
 *
 *  It is deliberately NOT `ENGINE_RISKS`. That list is the PATIENT RISK vocabulary and includes
 *  `none`; an alarm severity has no `none` (see `pillRisk`), so ranking by it would put an alarm
 *  carrying the string "none" LAST — the calmest place on the screen — where the whole point is
 *  that a severity this build cannot account for sorts first, because it may be the worst. */
function oldestFirst(a, b) {
  return (a.firstSeenAtMs ?? Infinity) - (b.firstSeenAtMs ?? Infinity);
}
/** «Ertelenenler»: the one whose snooze ends first, first (G2-B5b). */
function soonestBack(a, b) {
  return (a.snooze?.untilMs ?? Infinity) - (b.snooze?.untilMs ?? Infinity) || oldestFirst(a, b);
}
function worstFirst(a, b) {
  // After severity, an alarm that still fires before a critical that passed unacknowledged
  // (G2-A1): the latter waits for an answer, but the former is what is happening now.
  return SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity)
    || (a.status === "RESOLVED") - (b.status === "RESOLVED")
    || oldestFirst(a, b);
}

/** The severity's colour as text and as the card's bar — the prototype's `--r` on .card. An unknown
 *  severity takes the attention colour, never a quiet one (riskStyle's rule). */
const SEV_TEXT = Object.freeze({ crit: "text-crit", high: "text-high-ink", mid: "text-mid-ink", low: "text-low-ink", att: "text-att-ink", neutral: "text-mute" });

/** A small pill of the row's meta line (the prototype's .pill). */
function Pill({ tone = "neutral", icon, children, ...rest }) {
  const look = tone === "att" ? "bg-att text-att-ink" : tone === "crit" ? "bg-crit-soft text-crit-ink" : "bg-card2 text-mute";
  return (
    <span {...rest} className={`inline-flex items-center gap-[5px] rounded-full px-2 py-[3px] text-11.5 font-semibold leading-[normal] ${look}`}>
      {icon ? <Icon name={icon} size={12} /> : null}{children}
    </span>
  );
}

function Row({ alarm, nowMs, canAck, onAck, busy, canCall, onCall, canSnooze, onSnooze, critNote, patient, unitName }) {
  const { t } = useI18n();
  const age = elapsed(alarm.firstSeenAtMs, nowMs);
  const bed = alarm.bedLabel || alarm.patientId;
  const ackable = canAck && alarm.status !== "ACKNOWLEDGED";
  const callable = canCall && alarm.status !== "ACKNOWLEDGED" && !alarm.rrtCall;
  // G2-B5b (spec D4): «Ertele» on an unanswered, firing high or moderate alarm — a snoozed one too: a new snooze
  // replaces the old one.
  const snoozable = canSnooze && maySnooze(alarm);
  const call = alarm.rrtCall;
  // Said only while the snooze runs, by this screen's clock: once `until` has passed the alarm waits again.
  const snooze = isSnoozed(alarm, nowMs) ? alarm.snooze : null;
  const tone = riskStyle(pillRisk(alarm.severity), { measured: true }).tone;
  const name = patient?.display_name || null;
  return (
    // The prototype's alarm card: the age large in the severity's colour, a 4 px bar, the patient and
    // what fired, the actions at the right.
    <li className="grid grid-cols-[70px_4px_minmax(0,1fr)_auto] items-center gap-3 rounded-[14px] border border-line bg-card px-3.5 py-3 max-[640px]:grid-cols-[56px_4px_minmax(0,1fr)]">
      <span className={`font-data text-16 font-bold leading-[normal] ${SEV_TEXT[tone] ?? SEV_TEXT.att}`}>
        {age === null ? "—" : (<><span className="sr-only">{`${t("alarms.elapsed")}: `}</span>{age}</>)}
      </span>
      <span aria-hidden="true" className={`h-full min-h-[44px] w-1 rounded-sm ${railOf(tone)}`} />
      <div className="min-w-0">
        <p className="m-0 flex flex-wrap items-center gap-x-1.5 gap-y-1">
          <a
            href={`#/patients/${encodeURIComponent(alarm.patientId ?? "")}`}
            aria-label={t("alarms.openPatient", { bed })}
            className={`rounded-md text-14.5 font-bold text-ink hover:underline ${FOCUS_RING}`}
          >
            {bed}{name ? ` · ${name}` : ""}
          </a>
          <span className="sr-only">{" · "}</span>
          <RiskPill risk={pillRisk(alarm.severity)} measured />
          {patient?.unitId ? <Pill>{unitName(patient.unitId)}</Pill> : null}
        </p>
        {/* The engine writes its summaries in English (reco/engine.py); marked so a screen reader
            pronounces them as English. The screen says once, below, that they are. */}
        <p lang="en" className="m-0 mt-0.5 text-13 text-mute">{summaryOf(alarm) ?? t("board.findingUnnamed")}</p>
        <p className="m-0 mt-1.5 flex flex-wrap items-center gap-1 text-11.5 text-mute">
          {age === null ? <Pill>{t("alarms.noElapsed")}</Pill> : null}
          {Number.isFinite(alarm.firstSeenAtMs) ? <Pill icon="clock"><span className="font-data">{hhmm(alarm.firstSeenAtMs)}</span></Pill> : null}
          {/* The engine's one escalation fact (see the head of this file): not the prototype's ladder. */}
          {alarm.escalated ? <Pill tone="crit" icon="alert">{t("board.escalated")}</Pill> : null}
          {/* G2-B5 (D8): the open call to the rapid-response team — who called it, and when. */}
          {call ? (
            <Pill tone="att" icon="zap">
              {t("rrt.called", { by: call.by || "—", time: Number.isFinite(call.atMs) ? hhmm(call.atMs) : "—" })}
            </Pill>
          ) : null}
          {/* G2-B5b (spec §2): until when, by whom and why. */}
          {snooze ? (
            <Pill data-snooze="" icon="clock">
              {t("ertele.snoozedRow", { until: hhmm(snooze.untilMs), by: snooze.by || "—", reason: snoozeReasonText(t, snooze) })}
            </Pill>
          ) : null}
          {/* G2-A1 (O17): a critical whose condition passed before anyone acknowledged it stays
              here, waiting, until someone does. Its sound has stopped (signals.js); the badge and
              the instant it passed say why it is still on the list. */}
          {alarm.status === "RESOLVED" ? <StatusPill tone="att">{t("alarms.resolvedUnacked")}</StatusPill> : null}
          {alarm.status === "RESOLVED" && Number.isFinite(alarm.resolvedAtMs) ? (
            <span>
              <span className="sr-only">{`${t("alarms.resolvedAt")}: `}</span>
              <span className="font-data">{hhmm(alarm.resolvedAtMs)}</span>
            </span>
          ) : null}
          {/* Visible, and marked as the engine's own explanation — but NOT in the counts that mean
              "someone must answer this" (boardStore `needsAnswer`). */}
          <ChronicExpected alarm={alarm} />
          {alarm.ackBy ? <Pill>{t("alarms.seenBy", { who: alarm.ackBy })}{Number.isFinite(alarm.ackAtMs) ? <span className="font-data">{` · ${hhmm(alarm.ackAtMs)}`}</span> : null}</Pill> : null}
        </p>
      </div>
      {ackable || callable || snoozable || critNote ? (
        <div className="flex flex-wrap items-center justify-end gap-1.5 max-[640px]:col-span-3">
          {/* The prototype's order: «Gördüm» · «Ertele» · «Eskale» — here «RRT çağır», the live
              system's way to escalate by hand (G2-B5). Named like the row: the words, then the bed
              and the kind it is for. */}
          {ackable ? (
            <>
              <Button variant="primary" size="sm" busy={busy} onClick={() => onAck(alarm)}
                aria-label={t("alarms.ackLabel", { bed, kind: alarm.kind })}>
                {t("alarms.seen")}
              </Button>
              {/* A busy Button reads only "unavailable" to a screen reader; the words come from here
                  (Wave 1B's note for G1-10's first use of `busy`). */}
              <Announce text={busy ? t("alarms.seeing") : ""} />
            </>
          ) : null}
          {snoozable ? (
            <Button size="sm" onClick={() => onSnooze(alarm)}
              aria-label={t("ertele.snoozeLabel", { bed, kind: alarm.kind })}>
              {t("ertele.snooze")}
            </Button>
          ) : null}
          {/* G2-B5b (spec D4): «Kritik alarm ertelenemez», once on the screen, where «Ertele» would be. */}
          {critNote ? <span className="text-11.5 text-mute">{t("ertele.criticalNever")}</span> : null}
          {callable ? (
            <Button variant="danger" size="sm" onClick={() => onCall(alarm)}
              aria-label={t("rrt.callLabel", { bed, kind: alarm.kind })}>
              {t("rrt.call")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/** `sectionRef`: where the focus goes when a write took away the button it was on (DevirScreen's rule): the list is
 *  then focusable, named by its heading, and shows the ring. */
function Section({ titleKey, emptyKey, alarms, nowMs, canAck, onAck, busyId, canCall, onCall, canSnooze = false, onSnooze, critNoteId = null, counted, level = 2, sectionRef, patientOf, unitName }) {
  const { t } = useI18n();
  const Heading = `h${level}`;
  const titleId = useId();
  return (
    <section ref={sectionRef} tabIndex={sectionRef ? -1 : undefined} aria-labelledby={sectionRef ? titleId : undefined}
      className={sectionRef ? `rounded-box ${FOCUS_RING}` : ""}>
      {/* The prototype's .sec: 14 px, 18 px above and 10 px below. */}
      <Heading id={titleId} className="m-0 mb-2.5 mt-[18px] flex items-center gap-2 font-display text-14 font-bold leading-[normal] text-ink">
        {t(titleKey)}
        {/* `counted` is `known || stale`, and these are the two largest numbers on the screen. On
            an unreadable board `refresh()` has emptied it, so an ungated `alarms.length` printed
            a bold 0 beside "waiting for a response" — inches from a group label that correctly
            said it could not know. A STALE number is defensible and the bell already shows one;
            a zero the board cannot know is not. */}
        {counted ? <span className="rounded-full bg-card2 px-2 py-[3px] font-data text-11.5 font-semibold text-mute">{alarms.length}</span> : null}
      </Heading>
      {alarms.length === 0 ? (
        <Empty icon="bell">{t(emptyKey)}</Empty>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {alarms.map((a) => (
            <Row key={a.id} alarm={a} nowMs={nowMs} canAck={canAck} onAck={onAck} busy={busyId === a.id}
              canCall={canCall} onCall={onCall} canSnooze={canSnooze} onSnooze={onSnooze}
              critNote={critNoteId === a.id} patient={patientOf(a.patientId)} unitName={unitName} />
          ))}
        </ul>
      )}
    </section>
  );
}

export function AlarmsScreen() {
  const { t } = useI18n();
  const board = useBoard();
  const { user } = useSession();
  const toast = useToast();
  const nowMs = useBoardNow(TICK_MS);
  const [only, setOnly] = useState("all");
  const [busyId, setBusyId] = useState(null);
  const [callFor, setCallFor] = useState(null);   // the alarm whose «RRT çağır» dialog is open, or null
  const [snoozeFor, setSnoozeFor] = useState(null); // the alarm whose «Ertele» dialog is open, or null (G2-B5b)
  // A snooze moves its row to «Ertelenenler», and the button the dialog was opened from goes with it: the focus would
  // fall to <body>. It goes to that list instead, and only from there — a focus she has moved on is hers (DevirScreen's
  // `refocus`). A refusal leaves the row where it was, and the dialog gives the focus back to its button.
  const snoozedRef = useRef(null);
  const [refocus, setRefocus] = useState(0);
  useEffect(() => {
    if (!refocus) return;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    snoozedRef.current?.focus();
  }, [refocus]);
  // The card names the patient and the unit as the prototype does: from the board's own cards.
  const byId = useMemo(() => new Map((board.patients ?? []).map((p) => [p.patient_id, p])), [board.patients]);
  const patientOf = (id) => byId.get(id) ?? null;
  const unitName = useUnitNames((board.patients ?? []).map((p) => p.unitId).filter(Boolean)).nameOf;
  const canAck = user?.perms?.includes("alerts.ack") ?? false;
  const canCall = user?.perms?.includes("alerts.escalate") ?? false;
  const known = boardKnown(board.connection);
  const stale = boardStale(board.connection);
  // WHAT AN EMPTY SECTION IS ALLOWED TO SAY. "No alarm is awaiting a response" is a claim about
  // the ward, and only a LIVE board may make it. A board that may be out of date says that, and
  // one that could not be loaded says it cannot be read — never a sentence a reader would take
  // for a calm ward. A filter the clinician set is a third case, and is about the filter.
  const emptyKey = (none) => {
    if (only === "crit" && board.alerts.length > 0) return "alarms.emptyFiltered";
    if (known) return none;
    return stale ? "alarms.unknown" : "alarms.unavailable";
  };

  const { waiting, snoozed, reviewing, hidden, openTotal } = useMemo(() => {
    const picked = only === "crit" ? board.alerts.filter((a) => a.severity === "critical") : board.alerts;
    const open = picked.filter((a) => a.status !== "ACKNOWLEDGED");
    return {
      // G2-B5b (spec D4): a snoozed alarm waits in «Ertelenenler» until its `until`, by this screen's clock, and
      // comes back here on its own when that passes.
      waiting: open.filter((a) => !isSnoozed(a, nowMs)).sort(worstFirst),
      snoozed: open.filter((a) => isSnoozed(a, nowMs)).sort(soonestBack),
      reviewing: picked.filter((a) => a.status === "ACKNOWLEDGED").sort(oldestFirst),
      // How many the filter is keeping off the screen. A silent filter is the bed board's own
      // lesson (`beds.unitHidden`/`searchHidden`): a list narrowed by a control you cannot see
      // the effect of is a list you cannot trust to be the ward.
      hidden: board.alerts.length - picked.length,
      // THE COUNT SPEAKS FOR THE WARD, NOT FOR THE FILTER. Computed from `board.alerts`, so the
      // group's accessible name agrees with the rail's badge and the bell, which read the same
      // board: it was taken from the filtered list, and one page contradicting itself about how
      // many alarms are open is worse than either number alone.
      openTotal: board.alerts.filter((a) => a.status !== "ACKNOWLEDGED").length,
    };
  }, [board.alerts, only, nowMs]);
  // «Kritik alarm ertelenemez», ONCE (spec D4): beside the first critical alarm that waits, where «Ertele» would be,
  // for whoever may snooze (`alerts.ack`, owner D1).
  const critNoteId = canAck ? (waiting.find((a) => a.severity === "critical")?.id ?? null) : null;

  async function acknowledge(alarm) {
    if (busyId) return;                       // one at a time: the answer rewrites the board
    setBusyId(alarm.id);
    try {
      // The store makes the call and puts the answer on the board; nothing is written before the
      // server has taken it, so there is nothing to roll back if it refuses.
      await board.store.acknowledge(alarm.patientId, alarm.kind);
      toast(t("alarms.ackDone"));
    } catch (err) {
      // Shown, not swallowed, and the list is NOT changed: nothing was acknowledged. A 404 means
      // the alarm is no longer open — somebody else answered it, or it cleared.
      //
      // ON THE TOAST, the same carrier the patient screen's charting uses, and the consistency is
      // the point rather than a side effect: the two clinical writes this build has must behave
      // alike when the server says no. A refusal held in this screen's state died with the
      // screen, so a nurse who moved on mid-write saw no error and would believe the alarm was
      // answered when nobody had answered it. The toast's provider is above the router, so it
      // outlives the move; and because each refusal is a new toast item, two identical refusals
      // are two announcements without the remount trick the inline Alert needed.
      //
      // AND IT NAMES THE ALARM — the bed and the kind, in the vocabulary the row itself uses
      // (`bedLabel || patientId`, never a name). Outliving the screen is what makes attribution
      // necessary: "you do not have permission", read anywhere else, says that something failed
      // and not which alarm is still unanswered.
      const bed = alarm.bedLabel || alarm.patientId;
      toast(t("alarms.ackRefused", { subject: `${bed} · ${alarm.kind}`, reason: apiErrorText(t, err) }), "error");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex min-h-0 flex-col gap-3">
      {/* The prototype's .ph, then its filter under it. */}
      <div>
        <h1 className="m-0 font-display text-23 font-bold leading-[1.1]">{t("nav.alarms")}</h1>
        <p className="m-0 mt-1 text-13 text-mute">{t("alarms.sub")}</p>
      </div>
      {/* No number unless the board is LIVE. This was the one count on the screen with no
          `known` guard: it read "Açıq · 0" beside the crit alert saying the board could not be
          read at all — and zero is the most reassuring thing this screen can print. */}
      <Seg className="self-start" label={known ? t("alarms.openCount", { count: openTotal }) : t("alarms.openUnknown")} value={only} onChange={setOnly} options={[
        { value: "all", label: known ? t("alarms.allCount", { count: openTotal }) : t("alarms.all") },
        { value: "crit", label: t("alarms.criticalOnly") },
      ]} />

      <BoardStrip connection={board.connection} />
      <ScopeNote scope={board.scope} scopeNote={board.scopeNote} />
      {/* A board that is not LIVE may not be spoken of as the whole truth, and this screen's whole
          subject is "what is still waiting" — the sentence it must never imply when it cannot know. */}
      {!known && !stale ? <Alert tone="crit">{t("alarms.unavailable")}</Alert> : null}
      {stale ? <Note tone="warn" icon="alert">{t("alarms.unknown")}</Note> : null}
      {!canAck ? <Note tone="info" icon="shield">{t("alarms.noAckPerm")}</Note> : null}
      {hidden > 0 ? <p className="m-0 text-12.5 text-mute">{t("alarms.critHidden", { count: hidden })}</p> : null}
      {canAck && stale ? <Note tone="warn" icon="clock">{t("alarms.notLive")}</Note> : null}
      <Section
        titleKey="alarms.waiting" emptyKey={emptyKey("alarms.emptyWaiting")}
        alarms={waiting} nowMs={nowMs} canAck={canAck} onAck={acknowledge} busyId={busyId}
        canCall={canCall} onCall={setCallFor}
        canSnooze={canAck} onSnooze={setSnoozeFor} critNoteId={critNoteId}
        counted={known || stale} patientOf={patientOf} unitName={unitName}
      />
      {/* G2-B5b (spec D4): «Ertelenenler», only while one is snoozed, the soonest back first. Each can still be
          answered, called or snoozed again. */}
      {snoozed.length > 0 ? (
        <Section
          titleKey="ertele.groupTitle" emptyKey="ertele.groupEmpty" sectionRef={snoozedRef}
          alarms={snoozed} nowMs={nowMs} canAck={canAck} onAck={acknowledge} busyId={busyId}
          canCall={canCall} onCall={setCallFor}
          canSnooze={canAck} onSnooze={setSnoozeFor}
          counted={known || stale} patientOf={patientOf} unitName={unitName}
        />
      ) : null}
      <Section
        titleKey="alarms.reviewing" emptyKey={emptyKey("alarms.emptyReviewing")}
        alarms={reviewing} nowMs={nowMs} canAck={false} onAck={acknowledge} busyId={busyId}
        canCall={false} onCall={setCallFor}
        counted={known || stale} patientOf={patientOf} unitName={unitName}
      />
      <RrtCallDialog alarm={callFor} open={callFor !== null} onClose={() => setCallFor(null)} />
      <SnoozeDialog alarm={snoozeFor} open={snoozeFor !== null} onClose={() => setSnoozeFor(null)}
        onSnoozed={() => setRefocus((n) => n + 1)} />

      {/* Its own heading: this box is about CLOSED alarms, and titling it "Under review" put a
          second identical <h2> on the page. */}
      <Box title={t("alarms.closedTitle")} icon="clip" level={2} className="!border-dashed">
        <p className="m-0 text-12.5 text-mute">{t("alarms.closedGone")}</p>
        <p className="m-0 mt-1.5 text-12.5 text-mute">{t("board.escalatedHelp")}</p>
        <p className="m-0 mt-1.5 text-12.5 text-mute">{t("board.engineEnglish")}</p>
      </Box>
    </div>
  );
}

// src/live/screens/alarms/AlarmsScreen.jsx — the open alarms (G1-10).
//
// TWO SECTIONS, NOT THREE. The prototype has "awaiting response", "under review" and "closed in
// the last hour". The first two are the board's own two states (`acknowledged` false and true).
// The third cannot be built: `/patients` carries the engine's ACTIVE alarms only, so a closed
// alarm simply leaves the board, and the only durable record of it is the audit trail — which
// needs `audit.view`, which no nurse has, and whose reads return the OLDEST rows first (a known
// engine defect, roadmap "Dalga 0'dan açık kalanlar"). An empty "closed today" section would read
// as "nothing was closed today", which is a different and false statement. So the screen says in
// one sentence where a closed alarm went, and shows two sections.
//
// ONE ESCALATION FACT, NOT A LADDER. The prototype draws three pills — 3 / 5 / 10 minutes,
// charge nurse / physician / rapid-response — and advances them when a human clicks "Escalate".
// Nothing behind the live API has that shape: the board carries one boolean, `escalated`, which
// the engine's own escalation loop sets. The prototype's own admin screen admits the chain is "in
// the engine's code but not connected". So: the engine's flag, named, with one sentence saying
// whose business escalation is. Snooze and manual escalation are Group 2 (the roadmap's list).
//
// THE AGE IS THE SERVER'S INSTANT ON THIS BROWSER'S CLOCK. `firstSeenAtMs` with `elapsed()`:
// `m:ss` under an hour, `h:mm:ss` above (never "318:30"), `0:00` for an instant that has not
// arrived, and NO duration at all when the engine sent no first-seen time — never an invented one.
// Nothing runs on the simulation's clock, which is gone.
import React, { useMemo, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useBoard } from "../../data/BoardProvider.jsx";
import { useSession } from "../../session/SessionProvider.jsx";
import { apiErrorText } from "../../apiErrors.js";
import { Alert, Announce, Box, Button, Empty, Note, RiskPill, Seg, StatusPill, useToast } from "../../ui/index.js";
import { FOCUS_RING } from "../../ui/focus.js";
import { hhmm } from "../../i18n/dates.js";
import {
  BoardStrip, ChronicExpected, ScopeNote, boardKnown, boardStale, summaryOf, useBoardNow,
} from "../common/BoardState.jsx";
import { elapsed } from "../common/elapsed.js";

/** The ages on this screen tick every second: how long an alarm nobody has answered has been open
 *  is the number this screen exists to show. `useNow` skips the tick while the tab is hidden. */
const TICK_MS = 1_000;

/** An alarm's severity as a pill may show it. "none" is a PATIENT's risk — "no alarm at all" — and
 *  never an alarm's own severity; shown as one it would read "no finding" beside an alarm nobody
 *  has answered. Handed over as an unreported risk instead: the attention look, never calm.
 *  (The same mapping the bell uses, shell/TopBar.jsx.) */
const pillRisk = (severity) => (severity === "none" ? null : severity);

/** Oldest first, and a severity this build does not know first of all — it may be the worst (the
 *  rule `waitingAlarms` follows for the bell). */
const RANK = ["critical", "high", "moderate", "low", "info"];
function oldestFirst(a, b) {
  return (a.firstSeenAtMs ?? Infinity) - (b.firstSeenAtMs ?? Infinity);
}
function worstFirst(a, b) {
  return RANK.indexOf(a.severity) - RANK.indexOf(b.severity) || oldestFirst(a, b);
}

function Row({ alarm, nowMs, canAck, onAck, busy }) {
  const { t } = useI18n();
  const age = elapsed(alarm.firstSeenAtMs, nowMs);
  const bed = alarm.bedLabel || alarm.patientId;
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2 border-t border-line px-3 py-2.5 first:border-t-0 max-[640px]:grid-cols-[auto_minmax(0,1fr)]">
      <RiskPill risk={pillRisk(alarm.severity)} measured />
      <div className="min-w-0">
        <a
          href={`#/patients/${encodeURIComponent(alarm.patientId ?? "")}`}
          aria-label={t("alarms.openPatient", { bed })}
          className={`rounded-md font-data text-13.5 font-bold text-ink ${FOCUS_RING}`}
        >
          {bed}
        </a>
        {/* The engine writes its summaries in English (reco/engine.py); marked so a screen reader
            pronounces them as English. The screen says once, below, that they are. */}
        <p lang="en" className="m-0 text-13 text-ink">{summaryOf(alarm) ?? t("board.findingUnnamed")}</p>
        <p className="m-0 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-11.5 text-mute">
          {age === null ? (
            <span>{t("alarms.noElapsed")}</span>
          ) : (
            <span>
              <span className="sr-only">{`${t("alarms.elapsed")}: `}</span>
              <b className="font-data text-12.5 text-ink">{age}</b>
            </span>
          )}
          {Number.isFinite(alarm.firstSeenAtMs) ? <span className="font-data">{hhmm(alarm.firstSeenAtMs)}</span> : null}
          {alarm.escalated ? <StatusPill tone="att" icon="alert">{t("board.escalated")}</StatusPill> : null}
          {/* Visible, and marked as the engine's own explanation — but NOT in the counts that mean
              "someone must answer this" (boardStore `needsAnswer`). */}
          <ChronicExpected alarm={alarm} />
          {alarm.ackBy ? <span>{t("alarms.seenBy", { who: alarm.ackBy })}</span> : null}
          {Number.isFinite(alarm.ackAtMs) ? <span className="font-data">{hhmm(alarm.ackAtMs)}</span> : null}
        </p>
      </div>
      {canAck && alarm.status !== "ACKNOWLEDGED" ? (
        <>
          <Button variant="primary" size="sm" icon="ok" busy={busy} onClick={() => onAck(alarm)}>
            {t("alarms.seen")}
          </Button>
          {/* A busy Button reads only "unavailable" to a screen reader; the words come from here
              (Wave 1B's note for G1-10's first use of `busy`). */}
          <Announce text={busy ? t("alarms.seeing") : ""} />
        </>
      ) : null}
    </li>
  );
}

function Section({ titleKey, emptyKey, alarms, nowMs, canAck, onAck, busyId, level = 2 }) {
  const { t } = useI18n();
  const Heading = `h${level}`;
  return (
    <section className="grid gap-2">
      <Heading className="m-0 flex items-center gap-2 font-text text-11 font-bold uppercase leading-[normal] tracking-[.08em] text-mute">
        {t(titleKey)}
        <span className="font-data text-12 text-ink">{alarms.length}</span>
      </Heading>
      {alarms.length === 0 ? (
        <Empty icon="bell">{t(emptyKey)}</Empty>
      ) : (
        <ul className="m-0 list-none rounded-box border border-line bg-card p-0">
          {alarms.map((a) => (
            <Row key={a.id} alarm={a} nowMs={nowMs} canAck={canAck} onAck={onAck} busy={busyId === a.id} />
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
  const [failure, setFailure] = useState(null);
  const canAck = user.perms.includes("alerts.ack");
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

  const { waiting, reviewing } = useMemo(() => {
    const picked = only === "crit" ? board.alerts.filter((a) => a.severity === "critical") : board.alerts;
    return {
      waiting: picked.filter((a) => a.status !== "ACKNOWLEDGED").sort(worstFirst),
      reviewing: picked.filter((a) => a.status === "ACKNOWLEDGED").sort(oldestFirst),
    };
  }, [board.alerts, only]);

  async function acknowledge(alarm) {
    if (busyId) return;                       // one at a time: the answer rewrites the board
    setBusyId(alarm.id);
    setFailure(null);
    try {
      // The store makes the call and puts the answer on the board; nothing is written before the
      // server has taken it, so there is nothing to roll back if it refuses.
      await board.store.acknowledge(alarm.patientId, alarm.kind);
      toast(t("alarms.ackDone"));
    } catch (err) {
      // Shown, not swallowed, and the list is NOT changed: nothing was acknowledged. A 404 means
      // the alarm is no longer open — somebody else answered it, or it cleared.
      setFailure(err);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex min-h-0 max-w-[1000px] flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="m-0 font-display text-23 font-bold">{t("nav.alarms")}</h1>
          <p className="m-0 text-13 text-mute">{t("alarms.sub")}</p>
        </div>
        <Seg label={t("alarms.openCount", { count: waiting.length })} value={only} onChange={setOnly} options={[
          { value: "all", label: t("alarms.all") },
          { value: "crit", label: t("alarms.criticalOnly"), icon: "alert" },
        ]} />
      </div>

      <BoardStrip connection={board.connection} />
      <ScopeNote scope={board.scope} scopeNote={board.scopeNote} />
      {/* A board that is not LIVE may not be spoken of as the whole truth, and this screen's whole
          subject is "what is still waiting" — the sentence it must never imply when it cannot know. */}
      {!known && !stale ? <Alert tone="crit">{t("alarms.unavailable")}</Alert> : null}
      {stale ? <Note tone="warn" icon="alert">{t("alarms.unknown")}</Note> : null}
      {!canAck ? <Note tone="info" icon="shield">{t("alarms.noAckPerm")}</Note> : null}
      {canAck && stale ? <Note tone="warn" icon="clock">{t("alarms.notLive")}</Note> : null}
      {failure ? <Alert tone="crit" key={String(busyId)}>{apiErrorText(t, failure)}</Alert> : null}

      <Section
        titleKey="alarms.waiting" emptyKey={emptyKey("alarms.emptyWaiting")}
        alarms={waiting} nowMs={nowMs} canAck={canAck} onAck={acknowledge} busyId={busyId}
      />
      <Section
        titleKey="alarms.reviewing" emptyKey={emptyKey("alarms.emptyReviewing")}
        alarms={reviewing} nowMs={nowMs} canAck={false} onAck={acknowledge} busyId={busyId}
      />

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

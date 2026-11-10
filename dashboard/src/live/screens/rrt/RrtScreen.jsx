// src/live/screens/rrt/RrtScreen.jsx — the rapid-response team's screen (G2-B5, spec D6; owner D1).
//
// THE RRT COMES ONLY WHEN CALLED BY HAND (owner D1). The live engine has one escalation step: an urgent alarm
// nobody answered goes to the DOCTOR after five minutes (api/escalation.py). It never pages the RRT, and the
// Postgres module's three-tier ladder (charge nurse → physician → RRT) is not connected to anything. So the
// screen says that in a fixed note, rather than letting a reader infer an automatic third step from the second
// list: those alarms are on their way to somebody, and that somebody is not this team unless a person calls it.
//
// TWO LISTS, BOTH FROM THE BOARD (`rrtQueue`, rrt.js). The open calls, oldest call first; and the unanswered
// urgent alarms with no call, in the alarm queue's order. Nothing else is fetched: they follow the board's
// stream and its scope.
//
// THE ROWS ARE THE ALARM SCREEN'S (AlarmsScreen.jsx `Row`): the severity pill, the bed linking to the patient,
// the engine's English summary marked `lang="en"`, the age on the server's clock (`elapsed`, `useBoardNow`).
// «Gördüm» is the very same acknowledgement — `/ack`, which also answers the call (spec D4) — with the same
// one-at-a-time rule and the same toasts.
//
// WHAT AN EMPTY LIST MAY SAY. «No open call» is a claim about the ward, and only a LIVE board may make it
// (Decision 18): a board that may be out of date says so in its place, one that cannot be read says that.
import React, { useId, useMemo, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { useBoard } from "../../data/BoardProvider.jsx";
import { useSession } from "../../session/SessionProvider.jsx";
import { apiErrorText } from "../../apiErrors.js";
import { Announce, Box, Button, Empty, Note, RiskPill, StatusPill, useToast } from "../../ui/index.js";
import { FOCUS_RING } from "../../ui/focus.js";
import { hhmm } from "../../i18n/dates.js";
import { BoardStrip, ScopeNote, pillRisk, summaryOf, useBoardNow } from "../common/BoardState.jsx";
import { elapsed } from "../common/elapsed.js";
import { rrtQueue } from "./rrt.js";

/** The ages tick every second, as on the alarm screen: how long a call has gone unanswered is what this
 *  screen is for. */
const TICK_MS = 1_000;

/** How long the alarm has been open, as the alarm screen prints it — or that the engine sent no instant. */
function Age({ age }) {
  const { t } = useI18n();
  if (age === null) return <span>{t("alarms.noElapsed")}</span>;
  return (
    <span>
      <span className="sr-only">{`${t("alarms.elapsed")}: `}</span>
      <b className="font-data text-12.5 text-ink">{age}</b>
    </span>
  );
}

/** One alarm, as on the alarm screen; `meta` is what this list says about it, `detail` a line under that. */
function Row({ alarm, canAck, onAck, busy, meta, detail = null }) {
  const { t } = useI18n();
  const bed = alarm.bedLabel || alarm.patientId;
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2 border-t border-line py-2.5 first:border-t-0 first:pt-0 max-[640px]:grid-cols-[auto_minmax(0,1fr)]">
      <RiskPill risk={pillRisk(alarm.severity)} measured />
      <div className="min-w-0">
        <a
          href={`#/patients/${encodeURIComponent(alarm.patientId ?? "")}`}
          aria-label={t("alarms.openPatient", { bed })}
          className={`rounded-md font-data text-13.5 font-bold text-ink ${FOCUS_RING}`}
        >
          {bed}
        </a>
        {/* The engine writes its summaries in English (reco/engine.py); the screen says so once, below. */}
        <p lang="en" className="m-0 text-13 text-ink">{summaryOf(alarm) ?? t("board.findingUnnamed")}</p>
        <p className="m-0 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-11.5 text-mute">
          {meta}
          {/* G2-A1 (O17), as on the alarm screen: a critical whose rule stopped before anyone answered it stays,
              latched, until someone does. Its sound has stopped; the badge and the instant it passed say why it is
              still here. In both lists — a latched alarm can be called, and one on its way can be latched. */}
          {alarm.status === "RESOLVED" ? <StatusPill tone="att">{t("alarms.resolvedUnacked")}</StatusPill> : null}
          {alarm.status === "RESOLVED" && Number.isFinite(alarm.resolvedAtMs) ? (
            <span>
              <span className="sr-only">{`${t("alarms.resolvedAt")}: `}</span>
              <span className="font-data">{hhmm(alarm.resolvedAtMs)}</span>
            </span>
          ) : null}
        </p>
        {detail}
      </div>
      {canAck && alarm.status !== "ACKNOWLEDGED" ? (
        <>
          <Button variant="primary" size="sm" icon="ok" busy={busy} onClick={() => onAck(alarm)}
            aria-label={t("rrt.seenLabel", { bed, kind: alarm.kind })}>
            {t("rrt.seen")}
          </Button>
          {/* A busy Button reads only "unavailable"; the words come from here, as on the alarm screen. */}
          <Announce text={busy ? t("alarms.seeing") : ""} />
        </>
      ) : null}
    </li>
  );
}

/** A called alarm: who called, how long ago, and why (spec D6). */
function CalledRow({ alarm, nowMs, ...rest }) {
  const { t } = useI18n();
  const call = alarm.rrtCall;
  const ago = elapsed(call.atMs, nowMs);
  return (
    <Row
      alarm={alarm} {...rest}
      meta={(
        <>
          <Age age={elapsed(alarm.firstSeenAtMs, nowMs)} />
          <span className="font-semibold text-ink">{t("rrt.calledBy", { by: call.by || "—" })}</span>
          {ago === null ? null : <span>{t("rrt.calledAgo", { age: ago })}</span>}
        </>
      )}
      detail={call.reason ? <p className="m-0 mt-1 text-12.5 text-ink">{t("rrt.reason", { reason: call.reason })}</p> : null}
    />
  );
}

/** An urgent alarm nobody has answered and nobody has called the team to: escalated to the doctor, or how long
 *  it has waited (spec D6). */
function WaitingRow({ alarm, nowMs, ...rest }) {
  const { t } = useI18n();
  const age = elapsed(alarm.firstSeenAtMs, nowMs);
  return (
    <Row
      alarm={alarm} {...rest}
      meta={alarm.escalated ? (
        <>
          <Age age={age} />
          <StatusPill tone="att" icon="alert">{t("rrt.escalatedToDoctor")}</StatusPill>
        </>
      ) : age === null ? <Age age={null} /> : <span className="font-semibold text-ink">{t("rrt.unansweredFor", { age })}</span>}
    />
  );
}

/** One list, under its own heading, named by it for a screen reader's landmarks. `items` null: the board
 *  cannot be read, so there is no list at all. */
function Section({ titleKey, icon, items, emptyText, renderRow }) {
  const { t } = useI18n();
  const titleId = useId();
  return (
    <section aria-labelledby={titleId}>
      <Box title={<span id={titleId}>{t(titleKey)}</span>} icon={icon} level={2}>
        {items && items.length > 0 ? (
          <ul className="m-0 list-none p-0">{items.map(renderRow)}</ul>
        ) : (
          <Empty icon={icon}>{emptyText}</Empty>
        )}
      </Box>
    </section>
  );
}

export function RrtScreen() {
  const { t } = useI18n();
  const board = useBoard();
  const { user } = useSession();
  const toast = useToast();
  const nowMs = useBoardNow(TICK_MS);
  const [busyId, setBusyId] = useState(null);
  const canAck = user?.perms?.includes("alerts.ack") ?? false;
  const { alerts, connection } = board;
  const { known, stale, called, waiting } = useMemo(() => rrtQueue({ alerts, connection }), [alerts, connection]);
  // In place of a list's empty text when the board cannot vouch for it — never a sentence that reads as a quiet
  // ward (Decision 18; the alarm screen's `emptyKey`).
  const emptyText = (key) => {
    if (known) return t(key);
    return t(stale ? "rrt.unknown" : "rrt.unavailable");
  };

  // AlarmsScreen.acknowledge, with its reasons (see there): one at a time; nothing changes before the server
  // has taken it; a refusal is a toast — it outlives the screen — and names the alarm it was for.
  async function acknowledge(alarm) {
    if (busyId) return;
    setBusyId(alarm.id);
    try {
      await board.store.acknowledge(alarm.patientId, alarm.kind);
      toast(t("alarms.ackDone"));
    } catch (err) {
      const bed = alarm.bedLabel || alarm.patientId;
      toast(t("alarms.ackRefused", { subject: `${bed} · ${alarm.kind}`, reason: apiErrorText(t, err) }), "error");
    } finally {
      setBusyId(null);
    }
  }

  const rowProps = (alarm) => ({ alarm, nowMs, canAck, onAck: acknowledge, busy: busyId === alarm.id });

  return (
    <div className="flex min-h-0 max-w-[1000px] flex-col gap-3">
      <div>
        <h1 className="m-0 font-display text-23 font-bold">{t("rrt.title")}</h1>
        <p className="m-0 text-13 text-mute">{t("rrt.intro")}</p>
      </div>

      <BoardStrip connection={board.connection} />
      <ScopeNote scope={board.scope} scopeNote={board.scopeNote} />
      {/* Owner D1, said plainly: the automatic RRT step is off. */}
      <Note tone="info" icon="zap">{t("rrt.tierOff")}</Note>
      {!canAck ? <Note tone="info" icon="shield">{t("alarms.noAckPerm")}</Note> : null}

      <Section
        titleKey="rrt.calledTitle" icon="zap" items={called} emptyText={emptyText("rrt.calledEmpty")}
        renderRow={(alarm) => <CalledRow key={alarm.id} {...rowProps(alarm)} />}
      />
      <Section
        titleKey="rrt.waitingTitle" icon="clock" items={waiting} emptyText={emptyText("rrt.waitingEmpty")}
        renderRow={(alarm) => <WaitingRow key={alarm.id} {...rowProps(alarm)} />}
      />

      <p className="m-0 text-12.5 text-mute">{t("board.engineEnglish")}</p>
    </div>
  );
}

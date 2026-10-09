// src/live/screens/common/BoardState.jsx — what every board-reading screen must say about its own
// data before it says anything about a patient.
//
// This is the most important component of Wave 3, and it exists for one failure mode: a board that
// has stopped updating looks exactly like a calm ward. Three parts, in this order:
//
//   <BoardStrip>   the connection. LIVE says nothing (a working system is quiet); DEGRADED says
//                  the data may be out of date; UNAVAILABLE says the list is EMPTY BECAUSE THE
//                  LOAD FAILED, not because the ward is quiet; CONNECTING says it is still
//                  loading. The sentences are the old workspace's `liveConnection.boardView()`,
//                  which was written, tested and never put on a screen.
//   <ScopeNote>    the engine's own sentence about why this board is the size it is
//                  (`scope_note`), and the counts it sent with it. Never the screen's words: the
//                  server knows what it filtered and why, and it writes that sentence itself — a
//                  paraphrase in four languages is four chances to say something it did not.
//   <FeedHealth>   whether readings are still arriving (screens/common/feedHealth.js). An
//                  operational statement about the feed, never a clinical one about the values.
//
// `boardKnown(connection)` is the question a screen asks before it may write a reassuring sentence
// ("no open alarms", "nothing waiting"): only a LIVE board may. It is the same rule the bell and
// the lock screen read through `alarmCounts` / `lockSummary`; a screen that shows the cards
// themselves needs the flag rather than the summaries.
import React from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { CONNECTION } from "../../../liveConnection.js";
import { Alert, Note, Pill, StatusPill } from "../../ui/index.js";
import { hhmm } from "../../i18n/dates.js";
import { neverMeasured, oldestMeasurement } from "./freshness.js";
import { wardFeedHealth } from "./feedHealth.js";
import { useNow } from "./useNow.js";
import { useBoard } from "../../data/BoardProvider.jsx";

/** Whether this board may be spoken of as current — the only state in which a screen may say that
 *  nothing is waiting. DEGRADED has data but no open stream (or no reload since it opened), so what
 *  it shows is the last it had; the other two have nothing to show at all. */
export const boardKnown = (connection) => connection === CONNECTION.LIVE;
/** Whether it has data that may be out of date: shown, and marked. */
export const boardStale = (connection) => connection === CONNECTION.DEGRADED;

const STRIP = {
  [CONNECTION.DEGRADED]: { key: "board.degraded", tone: "warn", icon: "alert" },
  [CONNECTION.CONNECTING]: { key: "board.connecting", tone: "info", icon: "clock" },
};

/** The connection, where the eye lands first. A LIVE board draws nothing: a strip that is always
 *  there is a strip nobody reads.
 *
 *  DEGRADED and CONNECTING are a static `Note`, not a live region: the state can change while a
 *  clinician is reading a card, and something that spoke every time the ward's Wi-Fi flickered
 *  would be noise a screen-reader user learns to ignore — they meet it moving through the page.
 *  UNAVAILABLE is the exception and IS announced (`Alert`, role="alert"), because what it would
 *  otherwise be read as is "no patients". */
export function BoardStrip({ connection, className = "" }) {
  const { t } = useI18n();
  if (connection === CONNECTION.UNAVAILABLE) {
    return <Alert tone="crit" className={className}>{t("board.unavailable")}</Alert>;
  }
  const state = STRIP[connection];
  if (!state) return null;
  return <Note tone={state.tone} icon={state.icon} className={className}>{t(state.key)}</Note>;
}

/** The engine's sentence about this board's size, as the engine wrote it, plus the counts it sent
 *  with it (`scope.hidden`, `scope.unresolved_hidden`). A load that failed drops the scope with the
 *  patients (boardStore), so there is nothing to draw then — which is right: a stale scope block
 *  would explain an empty board as "this is your scope" when the reason was the connection. */
export function ScopeNote({ scope, scopeNote, className = "" }) {
  const { t } = useI18n();
  const hidden = Number.isFinite(scope?.hidden) ? scope.hidden : 0;
  const unresolved = Number.isFinite(scope?.unresolved_hidden) ? scope.unresolved_hidden : 0;
  if (!scopeNote && hidden === 0) return null;
  return (
    <Note tone="info" icon="shield" className={className}>
      {scopeNote ? (
        <>
          {/* The engine writes this sentence in Turkish (`api/board.py` `_scope_note`). Printing it
              verbatim is the right call — the server knows what it filtered — but printing it
              UNMARKED is not: a Russian- or Azerbaijani-reading clinician meets a sentence in a
              language the rest of the screen is not in, with nothing saying why, and a screen
              reader set to Russian pronounces Turkish letters as Russian ones. So `lang="tr"` for
              the synthesiser, and one line in the reader's own language saying where the sentence
              came from. The real fix is the engine answering in the requested language; that is
              Group 2's (Task 23 carries it). */}
          <span lang="tr">{scopeNote}</span>
          <span className="mt-0.5 block text-11 font-normal text-mute">{t("board.scopeNoteLang")}</span>
        </>
      ) : null}
      {hidden > 0 ? (
        <span className="mt-1 block font-normal">
          {t("board.hidden", { count: hidden })}
          {unresolved > 0 ? ` ${t("board.unresolved", { count: unresolved })}` : ""}
        </span>
      ) : null}
    </Note>
  );
}

/** What to print as a finding's headline: the engine's own summary, or its `kind` if there is none.
 *
 *  Every screen that shows a finding goes through this, so there is ONE place to improve it. The
 *  `kind` is a raw slug (`news2_red_param`, `sepsis_antibiotic_overdue`) and reads like a database
 *  row, which is poor. It is still what is printed, for one reason: a four-language name per kind
 *  would be this interface naming the engine's clinical findings, and a name is a claim about what
 *  a finding IS. Those names belong in the vault with a source behind each, and then in the
 *  engine's own payload — not invented in a dictionary file by the screen that displays them.
 *  Task 23 records it as a server-side gap. In practice the engine always sends a summary
 *  (reco/engine.py), so this is the seam, not the usual path. */
export const summaryOf = (alarm) => alarm?.summary || alarm?.kind || "";

/** A risk tone's accent colour, as a fill (the bed card's left rail) and as a left border (the
 *  patient screen's finding). One table for both, because the two screens draw the same thing in
 *  two places and are built on two branches: the bed card had this map and the patient screen had
 *  an inline ternary whose fallback caught `neutral` as well as `att`, so a finding of severity
 *  `info` — which riskStyle maps to `neutral` — came out quiet grey on the card and ATTENTION
 *  AMBER on the patient screen. Amber in this interface means "the screen cannot vouch for this"
 *  (riskStyle.js, `UNREPORTED`), so the same finding was telling a clinician two different things
 *  about how much the system knew.
 *
 *  Token classes only, and `att` is the fallback for a tone that is not in the table: an unknown
 *  tone must read as unvouchable, never as quiet. Nothing here is ever green. */
export const RAIL = Object.freeze({
  crit: "bg-crit", high: "bg-high", mid: "bg-mid", low: "bg-low",
  att: "bg-att-line", neutral: "bg-line2",
});
export const RAIL_LEFT = Object.freeze({
  crit: "border-l-crit", high: "border-l-high", mid: "border-l-mid", low: "border-l-low",
  att: "border-l-att-line", neutral: "border-l-line2",
});
/** The rail class for a tone; an unknown tone takes the attention colour, never the quiet one. */
export const railOf = (tone, table = RAIL) => table[tone] ?? table.att;

/** A finding the engine downgraded because the patient's own charted baseline explains it
 *  (`rules/patient_relative.py`: such a finding "stays visible but does NOT alarm or escalate").
 *
 *  It lives here, with the shared board components, rather than on the bed card where it was first
 *  needed, because the alarms row says it too — and the card and the row are built on separate
 *  branches. Two things it deliberately is not. It is not a risk pill: `tone="neutral"` is the one
 *  tone in STATUS_TONES that carries no judgement, and the rule that a Homunculus screen never
 *  paints a patient green (riskStyle.js) is not weakened by a pill that says only "this is
 *  explained". And it is not a reassurance: the finding is still on the card, still on the alarms
 *  screen, still in the engine's text. What it does not do is drive the waiting queue, the bell or
 *  the rail's red count (boardStore's `needsAnswer`), because nobody is being asked to answer it.
 *
 *  `chronicContext` is the engine's own explanation and is English prose (reco/engine.py). It is
 *  sr-only and `lang="en"`: the pill is short enough to read at a glance, and a clinician who wants
 *  the reason is on the patient screen; a screen-reader user, who cannot hover, gets it in the
 *  accessible name with the right language on it. */
export function ChronicExpected({ alarm }) {
  const { t } = useI18n();
  if (alarm?.downgraded !== true) return null;
  return (
    <StatusPill tone="neutral" icon="minus">
      {t("board.chronicExpected")}
      {alarm.chronicContext ? (
        <span className="sr-only" lang="en">{` · ${alarm.chronicContext}`}</span>
      ) : null}
    </StatusPill>
  );
}

/** Is data arriving? `silentCount` beds whose bed-alive channels have all gone quiet, how many have
 *  never been measured at all, and when the quietest card that HAS been measured last spoke. The
 *  chip is the whole statement a browser is entitled to make about the feed: it names beds, not
 *  values, and nothing here decides that a number is too old to act on (feedHealth.js, the header).
 *  The device page that would answer the next question is Group 4's.
 *
 *  IT SAYS NOTHING UNLESS THE BOARD IS LIVE, and that is the point of the `connection` argument
 *  rather than a nicety. Every sentence here is computed by ageing the snapshot's timestamps
 *  against a clock that keeps moving — but on a board that is not LIVE the snapshot is never
 *  reloaded (only the stream's `onOpen` reloads it). So through an outage this chip first says
 *  "data is arriving from every bed", which is reassurance nobody can vouch for, and then, once
 *  the windows pass, says every bed has gone silent — reporting OUR lost connection as the ward's
 *  dead monitors, which is the one way a feed-health indicator can do harm. `BoardStrip` is what
 *  speaks about the connection; this is only ever about the beds, so when the beds are unknowable
 *  it is absent. Same rule and same shape as `alarmCounts`/`lockSummary`: a number only from a
 *  board that is `known`. */
export function FeedHealth({ patients, connection, nowMs, className = "" }) {
  const { t } = useI18n();
  const list = Array.isArray(patients) ? patients : [];
  if (!boardKnown(connection) || list.length === 0) return null;
  const { silentCount } = wardFeedHealth(list, nowMs);
  // "Never wired" and "stopped reporting" are two problems needing two different people
  // (feedHealth.js: `absent` vs `stale`), so they are two numbers. A bed the bridge never
  // connected is not a monitor that failed, and counting them together sent a biomedical engineer
  // to look at a device that was never plugged in to anything.
  const never = neverMeasured(list);
  const stopped = silentCount - never;
  const oldest = oldestMeasurement(list);
  // The headline is what is WRONG, or `feedOk` when nothing is; the oldest instant is an addendum
  // to either, never a replacement for the headline (a chip that said only "oldest: 09:58" left
  // the reader to work out for themselves whether that was good news).
  const wrong = [
    stopped > 0 ? t("board.silent", { count: stopped }) : null,
    never > 0 ? t("board.neverMeasured", { count: never }) : null,
  ].filter(Boolean);
  const parts = [...(wrong.length > 0 ? wrong : [t("board.feedOk")])];
  if (oldest !== null) parts.push(t("board.oldest", { time: hhmm(oldest) }));
  return (
    <Pill icon="wifi" className={className}>
      {/* The chip's name says what it is about before it says the number: on its own, "2" beside a
          wireless icon is not a sentence. `Pill` takes no title, so the words are sr-only. */}
      <span className="sr-only">{`${t("board.feedTitle")}: `}</span>
      {parts.join(" · ")}
    </Pill>
  );
}

/** The time a board-reading screen measures ages against: this browser's clock, corrected by the
 *  skew the server stated in its last answer (`clockSkewMs`, boardStore). Re-read every `everyMs`
 *  like `useNow`, which it wraps.
 *
 *  Every screen that prints an age uses this and not `useNow` directly. The engine timestamps a
 *  reading by its own clock; a ward tablet with a wrong clock therefore ages every reading wrongly,
 *  and for half of all wrong clocks it ages them DOWNWARDS — a four-hour-old pressure drawn as
 *  "6 min". The correction does not make the number right, it makes it the server's number, which
 *  is the one the engine reasoned with.
 *
 *  An unknown skew (no answer seen yet, a header a proxy stripped) is 0, not a refusal to show the
 *  age: an uncorrected age is the status quo and is usually right to the second, and a screen that
 *  blanked every age until it had measured a clock would be worse on every correctly-set device in
 *  the hospital. Group 2's device page is where a skew worth telling someone about gets said out
 *  loud; this only stops it corrupting the ages in the meantime. */
export function useBoardNow(everyMs) {
  const { clockSkewMs } = useBoard();
  const now = useNow(everyMs);
  return now + (Number.isFinite(clockSkewMs) ? clockSkewMs : 0);
}

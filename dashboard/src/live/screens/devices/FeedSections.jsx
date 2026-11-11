// src/live/screens/devices/FeedSections.jsx — G4-01 «Cihaz & Veri Akışı» (spec 2026-11-11 D5): what the device
// page says first — is data arriving? Top to bottom: the verdict and its counts, the silent monitors, the stale
// channels, the data chain and the table's rows never seen; the editor and the strip cards follow, unchanged
// (DevicesScreen.jsx). The rules are deviceFeed.js's; this file only words them.
//
// Decision 18: only a fresh answer — the last poll answered, no longer ago than the display limit — may say a
// list is empty. One that is not is measured at its own generated_at and frozen there (no silence it did not carry
// appears); the verdict section leads with «Pano güncel değil · son yanıt {HH:MM}» and says the last verdict in the
// past tense, the chain's links keep their values with the state «bilinmiyor», the other sections are marked
// «Pano güncel değil · {HH:MM}», and nothing is called empty. A list that cannot be drawn — a broken chain, an
// unknown state or count, a view with no monitor, no ledger, no time — says why, never «yok». A polite status tells a screen
// reader the verdict and the freshness only, so it speaks when they change. No patient anywhere: monitors, channels
// and times. Nothing here alarms, sounds or counts on the rail.
import React, { useId } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { hhmm } from "../../i18n/dates.js";
import { Note, StatusPill, useAnnounced } from "../../ui/index.js";
import { SHADOW_PHASE } from "../../data/shadowStore.js";
import { readUnknown, stripOn } from "../common/MonitorStrip.jsx";
import { ageText, maxAgeOf } from "../common/monitor.js";
import { bedText, monitorName } from "./deviceMap.js";
import {
  chainLines, countsOf, listingOf, measuredAtMs, neverSeenRows, silentRows, staleLongCount, staleRows, verdictOf,
} from "./deviceFeed.js";

const WORD = Object.freeze({ ok: "cihaz.wordOk", down: "cihaz.wordDown", warn: "cihaz.wordWarn", unknown: "cihaz.wordUnknown" });
const TONE = Object.freeze({ ok: "ok", down: "att", warn: "att", unknown: "neutral" });
const COUNTS = Object.freeze([
  ["silent", "cihaz.countSilent"], ["stale", "cihaz.countStale"], ["standby", "cihaz.countStandby"],
  ["waiting", "cihaz.countWaiting"], ["unassigned", "cihaz.countUnassigned"],
]);

/** «4 dk'dır», or «<1 dk'dır» under a minute: every section's duration, in whole minutes (D5). */
const forText = (t, minutes) => (minutes === 0 ? t("cihaz.forUnderMinute") : t("cihaz.forMinutes", { n: minutes }));

/** One section: a level-2 heading under the page's own, the region named by it. */
function Section({ title, children }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-1.5 rounded-box bg-card p-3">
      <h2 id={id} className="m-0 font-display text-17 font-bold">{title}</h2>
      {children}
    </section>
  );
}

/** Why sections 2 and 3 do not list (deviceFeed.js listingOf): said instead of a list, and never the «none» sentence. */
const REASON = Object.freeze({
  chain: "cihaz.chainBlocks", unknown: "cihaz.listUnknown", noMonitors: "cihaz.listNoMonitors",
  noLedger: "cihaz.listNoLedger", noClock: "cihaz.listNoClock",
});

/** The verdict's words: the forwarder's silence carries its minutes, «the data flows» its two counts. */
function verdictText(t, verdict, key = verdict.key) {
  if (verdict.kind === "forwarder") return t(key, verdict.minutes === null ? undefined : { for: forText(t, verdict.minutes) });
  if (verdict.kind === "flowing" || verdict.kind === "noneSending") return t(key, { streaming: verdict.streaming, total: verdict.total });
  return t(key);
}

/** Each verdict's past-tense twin, said of an answer that is no longer fresh (cihaz.strings.test.js pins the pairs). */
const PAST = Object.freeze({
  "cihaz.verdictFlowing": "cihaz.pastFlowing", "cihaz.verdictNoneSending": "cihaz.pastNoneSending",
  "cihaz.verdictNoMonitors": "cihaz.pastNoMonitors", "cihaz.verdictCountsUnknown": "cihaz.pastCountsUnknown",
  "cihaz.verdictForwarder": "cihaz.pastForwarder", "cihaz.verdictForwarderNoTime": "cihaz.pastForwarderNoTime",
  "cihaz.verdictCollector": "cihaz.pastCollector", "cihaz.verdictNever": "cihaz.pastNever",
  "cihaz.verdictUnknown": "cihaz.pastUnknown",
});

/** What the screen reader's status says for each verdict, fresh and not: the verdict with no number in it — the
 *  forwarder's silence without its minutes, «the data flows» without its counts — so it speaks when the state
 *  changes, never every minute. */
const STATUS = Object.freeze({
  flowing: ["cihaz.statusFlowing", "cihaz.statusFlowingPast"],
  noneSending: ["cihaz.verdictNoneSending", "cihaz.pastNoneSending"],
  noMonitors: ["cihaz.verdictNoMonitors", "cihaz.pastNoMonitors"],
  countsUnknown: ["cihaz.verdictCountsUnknown", "cihaz.pastCountsUnknown"],
  forwarder: ["cihaz.verdictForwarderNoTime", "cihaz.pastForwarderNoTime"],
  collector: ["cihaz.verdictCollector", "cihaz.pastCollector"],
  never: ["cihaz.verdictNever", "cihaz.pastNever"],
  unknown: ["cihaz.verdictUnknown", "cihaz.pastUnknown"],
});

/** A visually hidden polite status, mounted empty with the sections and filled a moment later (useAnnounced: a
 *  region mounted with its text is not announced). It holds the verdict and, for an answer that is not fresh,
 *  «not up to date» — never a minute or a count. */
function FeedStatus({ t, verdict, fresh }) {
  const [now, past] = STATUS[verdict.kind] ?? STATUS.unknown;
  const said = useAnnounced(fresh ? t(now) : `${t("cihaz.statusNotFresh")} · ${t(past)}`);
  return <div role="status" className="sr-only" data-feed-status>{said}</div>;
}

/** The answer's own time, «HH:MM», for the marks of an answer that is not fresh; «—» for one with none. */
const stampText = (data) => {
  const stamp = Date.parse(data?.generated_at ?? "");
  return Number.isFinite(stamp) ? hhmm(stamp) : "—";
};

function Verdict({ t, data, verdict, counts, fresh }) {
  const watching = Date.parse(data.watching_since ?? "");
  // An answer that is not fresh is never today's «all fine»: the section leads with «not up to date · last answer»,
  // and the verdict follows in the past tense, as what that answer said.
  const text = verdictText(t, verdict, fresh ? verdict.key : PAST[verdict.key]);
  // Only the counts above zero: a «0» would be a list called empty, which is Decision 18's to allow; and none at all
  // under a verdict that does not list (a broken chain, an unknown state or count, a view with no monitor).
  const parts = counts === null ? []
    : COUNTS.filter(([name]) => counts[name] > 0).map(([name, key]) => t(key, { count: counts[name] }));
  return (
    <>
      {fresh ? null : <Note>{t("cihaz.notFreshLead", { time: stampText(data) })}</Note>}
      <p className="m-0 text-13 font-semibold">{text}</p>
      {parts.length > 0 ? <p className="m-0 text-13">{parts.join(" · ")}</p> : null}
      {Number.isFinite(watching) ? <p className="m-0 text-12.5 text-mute">{t("cihaz.watchingSince", { time: hhmm(watching) })}</p> : null}
    </>
  );
}

function SilentList({ t, rows }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0">
      {rows.map((row) => (
        <li key={row.source} data-source={row.source} className="text-13">
          <span className="font-semibold">{row.label ?? row.source}</span>
          {" · "}
          {row.minutes === null ? t("cihaz.silentNoTime")
            : t("cihaz.silentFor", { for: forText(t, row.minutes), time: hhmm(row.lastMs) })}
          {row.vanished ? ` · ${t("cihaz.vanished")}` : null}
        </li>
      ))}
    </ul>
  );
}

function StaleList({ t, rows }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0">
      {rows.map((row) => (
        <li key={row.source} data-source={row.source} className="text-13">
          <span className="font-semibold">{row.label ?? row.source}</span>
          {" · "}
          {row.channels.map((ch) => t("cihaz.staleChannel", { channel: t(`monitor.p.${ch.parameter}`), for: forText(t, ch.minutes) })).join("; ")}
        </li>
      ))}
    </ul>
  );
}

function chainText(t, line) {
  const age = ageText(t, line.ageS) ?? "—";
  if (line.id === "collector") return line.heard ? t("cihaz.chainCollector", { age }) : t("cihaz.chainCollectorNone");
  if (line.id === "forwarder") {
    return line.posted ? t("cihaz.chainForwarder", { age, sent: line.sent ?? "—", failed: line.failed ?? "—" })
      : t("cihaz.chainForwarderNone");
  }
  if (line.id === "hub") {
    return line.accepted === null ? t("cihaz.chainHubNone") : t("cihaz.chainHub", { accepted: line.accepted, old: line.old ?? "—" });
  }
  if (!line.rejected) return t("cihaz.chainRejectedNone");
  const other = line.other > 0 ? ` · ${t("cihaz.chainRejectedOther", { n: line.other })}` : "";
  return `${t("cihaz.chainRejected", line.rejected)}${other}`;
}

/** The chain's links. From an answer that is not fresh each keeps its last values as detail, but its state is
 *  «unknown»: a link that was up then is not known to be up now. */
function ChainList({ t, lines, fresh }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
      {lines.map((line) => (
        <li key={line.id} data-chain={line.id} className="flex flex-wrap items-center gap-2 text-13">
          <StatusPill tone={TONE[fresh ? line.word : "unknown"]}>{t(WORD[fresh ? line.word : "unknown"])}</StatusPill>
          {" "}
          <span>{chainText(t, line)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Section 5: the table's rows whose monitor the API has never had a report of, from the editor's own list
 *  (MappingSection's `onList`: the page asks for it once). Its own Decision 18: «none» only from a list that
 *  answered; a list that could not be read keeps its last rows and says so. */
function NeverSeen({ t, mapping }) {
  const rows = neverSeenRows(mapping.body);
  // A lane that is off (409 monitor_lane_off) answers no list either: said as a list that could not be read.
  const failed = mapping.phase === "unreadable" || mapping.phase === "off";
  const unread = failed ? <Note>{t("esleme.unreadable")}</Note> : null;
  if (rows.length === 0) {
    if (mapping.phase === "ok") return <p className="m-0 text-13 text-mute">{t("cihaz.neverNone")}</p>;
    if (mapping.phase === "loading") return <p className="m-0 text-13 text-mute">{t("esleme.loading")}</p>;
    return unread;
  }
  return (
    <>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {rows.map((d) => (
          <li key={d.source} data-source={d.source} className="text-13">
            <span className="font-semibold">{bedText(t, d)}</span>
            {" · "}
            <span className="font-data">{monitorName(d)}</span>
          </li>
        ))}
      </ul>
      {unread}
    </>
  );
}

/** `mayRead`: whether the session may read the strip (shadowStore mayReadShadow: board.view or devices.manage). A
 *  charge nurse with devices.map_beds alone reaches the page and its editor, but not the strip: sections 1–4 are then
 *  a note saying what they need. Section 5 is the editor's list, not the strip's, and answers whatever the strip
 *  does — off, not yet read, unreadable, or not this session's. */
export function FeedSections({ shadow, mapping = null, mayRead = true }) {
  const { t } = useI18n();
  const { data, nowMs, fetchedAtMs } = shadow;
  const never = mapping ? (
    <Section title={t("cihaz.neverTitle")}>
      <NeverSeen t={t} mapping={mapping} />
    </Section>
  ) : null;
  if (!mayRead || !stripOn(data)) {
    const right = mayRead ? null : <Note tone="info">{t("cihaz.needsRight")}</Note>;
    return right || never ? <div className="flex flex-col gap-2.5" data-feed-sections>{right}{never}</div> : null;
  }
  // Decision 18: only a fresh answer may say a list is empty, and one that is not is marked.
  const fresh = shadow.phase === SHADOW_PHASE.OK && !readUnknown(shadow, nowMs, maxAgeOf(data));
  const mark = fresh ? null : <Note>{t("cihaz.notFresh", { time: stampText(data) })}</Note>;
  // A fresh answer is measured at the server's now; one that is not, frozen at its own instant (measuredAtMs). The
  // chain's ages likewise: aged since the answer arrived only while it is fresh.
  const now = measuredAtMs(data, fresh, nowMs, fetchedAtMs);
  const chainNowMs = fresh ? nowMs : fetchedAtMs;
  const verdict = verdictOf(data, now);
  const listing = listingOf(data, verdict, now);
  // Section 2 lists under a ledger, and by status alone from an API before it; section 3 only under a ledger.
  const silent = listing === "rows" || listing === "noLedger" ? silentRows(data, now) : [];
  const stale = listing === "rows" ? staleRows(data, now) : [];
  // D4's amendment: the channels silent an hour or more are not listed, only counted, and only when there are some.
  const staleLong = listing === "rows" ? staleLongCount(data, now) : 0;
  const counts = verdict.listing === "rows" ? countsOf(data, silent, stale) : null;
  const reason = listing === "rows" ? null : <p className="m-0 text-13">{t(REASON[listing])}</p>;
  // Only a list that may be empty says so: a fresh answer whose monitors are listed one by one (Decision 18).
  const none = (key) => (fresh && listing === "rows" ? <p className="m-0 text-13 text-mute">{t(key)}</p> : null);
  return (
    <div className="flex flex-col gap-2.5" data-feed-sections>
      <FeedStatus t={t} verdict={verdict} fresh={fresh} />
      <Section title={t("cihaz.verdictTitle")}>
        <Verdict t={t} data={data} verdict={verdict} counts={counts} fresh={fresh} />
      </Section>
      <Section title={t("cihaz.silentTitle")}>
        {silent.length > 0 ? <SilentList t={t} rows={silent} /> : none("cihaz.silentNone")}
        {reason}
        {mark}
      </Section>
      <Section title={t("cihaz.staleTitle")}>
        {stale.length > 0 ? <StaleList t={t} rows={stale} /> : none("cihaz.staleNone")}
        {reason}
        {staleLong > 0 ? <p className="m-0 text-12.5 text-mute">{t("cihaz.staleLongCount", { n: staleLong })}</p> : null}
        {mark}
      </Section>
      <Section title={t("cihaz.chainTitle")}>
        <ChainList t={t} lines={chainLines(data, chainNowMs, fetchedAtMs)} fresh={fresh} />
        {mark}
      </Section>
      {never}
    </div>
  );
}

// src/live/screens/devices/FeedSections.jsx — G4-01 «Cihaz & Veri Akışı» (spec 2026-11-11 D5): what the device
// page says first — is data arriving? Top to bottom: the verdict and its counts, the silent monitors, the stale
// channels, the data chain and the table's rows never seen; the editor and the strip cards follow, unchanged
// (DevicesScreen.jsx). The rules are deviceFeed.js's; this file only words them.
//
// Decision 18: only a fresh answer — the last poll answered, no longer ago than the display limit — may say a
// list is empty; one that is not keeps what it said, marked «Pano güncel değil · {HH:MM}», and says nothing is
// empty. No patient anywhere: monitors, channels and times. Nothing here alarms, sounds or counts on the rail.
import React, { useId } from "react";
import { useI18n } from "../../i18n/I18nProvider.jsx";
import { hhmm } from "../../i18n/dates.js";
import { Note, StatusPill } from "../../ui/index.js";
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

function Verdict({ t, data, verdict, counts }) {
  const watching = Date.parse(data.watching_since ?? "");
  const text = verdictText(t, verdict);
  // Only the counts above zero: a «0» would be a list called empty, which is Decision 18's to allow; and none at all
  // under a verdict that does not list (a broken chain, an unknown state or count, an empty hub).
  const parts = counts === null ? []
    : COUNTS.filter(([name]) => counts[name] > 0).map(([name, key]) => t(key, { count: counts[name] }));
  return (
    <>
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
  return line.rejected ? t("cihaz.chainRejected", line.rejected) : t("cihaz.chainRejectedNone");
}

function ChainList({ t, lines }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
      {lines.map((line) => (
        <li key={line.id} data-chain={line.id} className="flex flex-wrap items-center gap-2 text-13">
          <StatusPill tone={TONE[line.word]}>{t(WORD[line.word])}</StatusPill>
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
  const unread = mapping.phase === "unreadable" ? <Note>{t("esleme.unreadable")}</Note> : null;
  if (rows.length === 0) {
    return mapping.phase === "ok" ? <p className="m-0 text-13 text-mute">{t("cihaz.neverNone")}</p> : unread;
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

export function FeedSections({ shadow, mapping = null }) {
  const { t } = useI18n();
  const { data, nowMs, fetchedAtMs } = shadow;
  if (!stripOn(data)) return null;
  // Decision 18: only a fresh answer may say a list is empty, and one that is not is marked.
  const fresh = shadow.phase === SHADOW_PHASE.OK && !readUnknown(shadow, nowMs, maxAgeOf(data));
  const stamp = Date.parse(data.generated_at ?? "");
  const mark = fresh ? null : <Note>{t("cihaz.notFresh", { time: Number.isFinite(stamp) ? hhmm(stamp) : "—" })}</Note>;
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
      <Section title={t("cihaz.verdictTitle")}>
        <Verdict t={t} data={data} verdict={verdict} counts={counts} />
        {mark}
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
        <ChainList t={t} lines={chainLines(data, chainNowMs, fetchedAtMs)} />
        {mark}
      </Section>
      {mapping ? (
        <Section title={t("cihaz.neverTitle")}>
          <NeverSeen t={t} mapping={mapping} />
        </Section>
      ) : null}
    </div>
  );
}

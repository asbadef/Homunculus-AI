// src/live/screens/devices/deviceFeed.js — G4-01 «Cihaz & Veri Akışı» (spec 2026-11-11 D4, D5): the device page's
// answer to "is data arriving?", pure. It reads the shadow board's answer (GET /infinity-shadow/board: the strip's
// cards plus the server's last-seen ledger) and the editor's list (GET /infinity-shadow/device-beds), and decides
// what the five sections say; FeedSections.jsx only words it.
//
// A duration is the server's: an instant the answer names (a card's `last_packet_at`, a channel's
// `last_value_at`, the feed's `last_post_at`) against the answer's own `generated_at` plus the time since it
// arrived on this browser's clock (`serverNowMs`) — two readings of one clock on each side, so a browser with a
// wrong clock cannot shorten a silence, and the durations tick between polls with ShadowProvider's 1 s clock.
// Whole minutes, floored: «4 dk» is a true lower bound, and 0 is «<1 dk».
//
// No patient and no value here — which monitor, which channel, since when — and no threshold on a value.
import { chipCounts, displayAge } from "../common/monitor.js";

/** The API sends `stale_list_after_s` (D4: a channel is listed once it has had no valid value this long); this
 *  is what it sends, for an answer from an API that sends none. */
export const STALE_LIST_AFTER_S = 60;

/** …and `stale_list_until_s` (D4's amendment): a channel silent this long drops out of the list — more likely
 *  removed on purpose (an arterial line taken out) than lost — and is counted on one closing line instead. */
export const STALE_LIST_UNTIL_S = 3600;

const MINUTE_MS = 60_000;
const QUIET = new Set(["silent", "unknown"]);
// A link of the chain that is down: its verdict, and every monitor is silent for that one reason.
const CHAIN = Object.freeze({
  never: { kind: "never", key: "cihaz.verdictNever" },
  collector_disconnected: { kind: "collector", key: "cihaz.verdictCollector" },
});
const FORWARDER_WORD = Object.freeze({ ok: "ok", collector_disconnected: "ok", forwarder_silent: "down", never: "unknown" });

const listOf = (value) => (Array.isArray(value) ? value : []);
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const nameOf = (row) => row.label ?? row.source;

function msOf(iso) {
  const ms = typeof iso === "string" ? Date.parse(iso) : NaN;
  return Number.isFinite(ms) ? ms : null;
}

/** The server's instant now: the answer's `generated_at` plus the time since it arrived, on this browser's clock.
 *  A clock now before the arrival (stepped back) adds nothing; an answer with no time gives null. */
export function serverNowMs(data, nowMs, fetchedAtMs) {
  const at = msOf(data?.generated_at);
  if (at === null) return null;
  if (!Number.isFinite(nowMs) || !Number.isFinite(fetchedAtMs) || nowMs < fetchedAtMs) return at;
  return at + (nowMs - fetchedAtMs);
}

/** Whole minutes in `ms`, floored; 0 is under a minute («<1 dk»). Null for no duration. */
export function minutesOf(ms) {
  return Number.isFinite(ms) ? Math.floor(Math.max(0, ms) / MINUTE_MS) : null;
}

/** The list-after limit in seconds: the server's, or STALE_LIST_AFTER_S from an answer that has none. */
export function staleAfterOf(data) {
  const server = data?.stale_list_after_s;
  return Number.isFinite(server) && server >= 0 ? server : STALE_LIST_AFTER_S;
}

/** The list-until limit in seconds: the server's, or STALE_LIST_UNTIL_S from an answer that has none. */
export function staleUntilOf(data) {
  const server = data?.stale_list_until_s;
  return Number.isFinite(server) && server >= 0 ? server : STALE_LIST_UNTIL_S;
}

/** Every card the caller is shown; `label` is the bed's for a bed card, null for an unassigned one. */
function cardsOf(data) {
  return [...listOf(data?.beds).map((card) => ({ card, label: card.bed_label ?? null })),
    ...listOf(data?.unassigned).map((card) => ({ card, label: null }))];
}

/** Section 1's verdict (`kind`, its words' `key`), and how sections 2 and 3 may answer under it (`listing`):
 *    "rows"        the monitors one by one — a chain that works, the server's counts read;
 *    "chain"       a link is down (the forwarder's silence with its minutes, the collector, «never»): every monitor
 *                  is silent for that one reason, and none is listed as a fault;
 *    "unknown"     a feed state this build does not know, or a count the answer does not carry — a count it was
 *                  not told is no count, never a zero (chipCounts): nothing is listed, and nothing called fine;
 *    "noMonitors"  the hub reports no monitor: there is nothing to list, which is not «none silent».
 *  «The data flows» only while a monitor sends: a working chain with none sending says so. */
export function verdictOf(data, now) {
  const feed = data?.feed ?? {};
  if (feed.state === "ok") {
    if (chipCounts(data) === null) return { kind: "countsUnknown", key: "cihaz.verdictCountsUnknown", listing: "unknown" };
    const { streaming, total } = feed.devices;
    if (total === 0) return { kind: "noMonitors", key: "cihaz.verdictNoMonitors", listing: "noMonitors" };
    if (streaming === 0) return { kind: "noneSending", key: "cihaz.verdictNoneSending", listing: "rows", streaming, total };
    return { kind: "flowing", key: "cihaz.verdictFlowing", listing: "rows", streaming, total };
  }
  if (feed.state === "forwarder_silent") {
    const last = msOf(feed.last_post_at);
    const minutes = last !== null && now !== null ? minutesOf(now - last) : null;
    const key = minutes === null ? "cihaz.verdictForwarderNoTime" : "cihaz.verdictForwarder";
    return { kind: "forwarder", key, listing: "chain", minutes };
  }
  const link = CHAIN[feed.state];
  if (link) return { ...link, listing: "chain", minutes: null };
  return { kind: "unknown", key: "cihaz.verdictUnknown", listing: "unknown" };
}

/** Whether the answer carries the server's last-seen ledger (G4-01): `watching_since`, and `channels_seen` on every
 *  card. An API before it sends neither, and cannot say «since when». */
export function hasLedger(data) {
  return msOf(data?.watching_since) !== null && cardsOf(data).every(({ card }) => Array.isArray(card.channels_seen));
}

/** How sections 2 and 3 may answer: the verdict's listing; under a verdict that lists, "noClock" when there is no
 *  time to measure from (`now` null: an answer with no `generated_at`), and "noLedger" when the answer has no ledger —
 *  section 2 then lists the silent cards by their status alone, and section 3 nothing. Only "rows" may ever say a
 *  list is empty. */
export function listingOf(data, verdict, now) {
  if (verdict.listing !== "rows") return verdict.listing;
  if (now === null) return "noClock";
  if (!hasLedger(data)) return "noLedger";
  return "rows";
}

function quietRow(source, label, lastIso, vanished, now) {
  const lastMs = msOf(lastIso);
  return { source, label, lastMs, minutes: lastMs !== null && now !== null ? minutesOf(now - lastMs) : null, vanished };
}

function bySilence(a, b) {
  if (a.lastMs !== b.lastMs) {
    if (a.lastMs === null) return 1;
    if (b.lastMs === null) return -1;
    return a.lastMs - b.lastMs;
  }
  return cmp(nameOf(a), nameOf(b)) || cmp(a.source, b.source);
}

/** Section 2 «Sessiz monitörler»: every silent or unknown card and every vanished device, once each — a vanished
 *  device is also an unknown card (the server keeps it), and is said once, as vanished. The longest silence
 *  first; a row whose last packet is not known after every row whose is. */
export function silentRows(data, now) {
  const gone = new Map(listOf(data?.vanished).filter((v) => typeof v?.source === "string").map((v) => [v.source, v]));
  const rows = [];
  const listed = new Set();
  for (const { card, label } of cardsOf(data)) {
    const vanished = gone.has(card.source);
    if (!QUIET.has(card.status) && !vanished) continue;
    listed.add(card.source);
    rows.push(quietRow(card.source, label, card.last_packet_at ?? gone.get(card.source)?.last_packet_at, vanished, now));
  }
  for (const v of gone.values()) {
    if (!listed.has(v.source)) rows.push(quietRow(v.source, v.bed_label ?? null, v.last_packet_at, true, now));
  }
  return rows.sort(bySilence);
}

/** A card's channels that can be stale, each with the time of its last valid value. Only a card still sending
 *  (`streaming`) has any: a monitor in standby, silent or unknown has none — its silence is section 2's, and
 *  standby is counted on its own. NBP never: it comes when the cuff measures. */
function quietChannels(card) {
  if (card.status !== "streaming") return [];
  return listOf(card.channels_seen)
    .filter((ch) => typeof ch?.parameter === "string" && ch.parameter !== "nbp")
    .map((ch) => ({ parameter: ch.parameter, lastMs: msOf(ch.last_value_at) }))
    .filter((ch) => ch.lastMs !== null);
}

/** Section 3 «Eskiyen kanallar» (D4 and its amendment): per sending device, the channels whose silence is at
 *  least the list-after limit and less than the list-until limit — 60 s and 3599 s are listed, 59 s and 3600 s
 *  are not — oldest first; the devices by their oldest channel. */
export function staleRows(data, now) {
  if (now === null) return [];
  const afterMs = staleAfterOf(data) * 1000;
  const untilMs = staleUntilOf(data) * 1000;
  const rows = [];
  for (const { card, label } of cardsOf(data)) {
    const channels = quietChannels(card)
      .filter((ch) => now - ch.lastMs >= afterMs && now - ch.lastMs < untilMs)
      .map((ch) => ({ ...ch, minutes: minutesOf(now - ch.lastMs) }))
      .sort((x, y) => x.lastMs - y.lastMs || cmp(x.parameter, y.parameter));
    if (channels.length > 0) rows.push({ source: card.source, label, channels });
  }
  return rows.sort((a, b) => a.channels[0].lastMs - b.channels[0].lastMs || cmp(nameOf(a), nameOf(b)));
}

/** Section 3's closing count (D4's amendment): the channels of sending devices silent for the list-until limit
 *  or longer. They are not listed — more likely removed on purpose than lost — and the server still holds them
 *  (the ledger, `channels_seen`); the screen prints the line only when the count is above zero. */
export function staleLongCount(data, now) {
  if (now === null) return 0;
  const untilMs = staleUntilOf(data) * 1000;
  return cardsOf(data).reduce((sum, { card }) => sum + quietChannels(card).filter((ch) => now - ch.lastMs >= untilMs).length, 0);
}

/** Section 1's counts after a verdict that the data flows: silent monitors and stale channels (the rows'),
 *  standby, waiting and unassigned (the server's). A count the answer does not carry is 0 here; the screen prints
 *  only the counts above 0. */
export function countsOf(data, silent, stale) {
  const devices = data?.feed?.devices ?? {};
  const n = (value) => (Number.isInteger(value) && value >= 0 ? value : 0);
  return {
    silent: silent.length,
    stale: stale.reduce((sum, row) => sum + row.channels.length, 0),
    standby: n(devices.standby),
    waiting: n(devices.waiting),
    unassigned: n(data?.feed?.unassigned),
  };
}

/** Section 4 «Veri zinciri»: one line per link, each with its state word — ok, down, warn or unknown. The
 *  collector (connected, its last heartbeat's age), the forwarder (its last post's age, sent and failed), the
 *  hub's accepted and old-or-duplicate packets, and the refused values by reason. Ages are the server's plus the
 *  time since the answer arrived (`displayAge`). */
export function chainLines(data, nowMs, fetchedAtMs) {
  const feed = data?.feed ?? {};
  const aged = (seconds) => (Number.isFinite(seconds) ? displayAge({ age_s: seconds }, nowMs, fetchedAtMs) : null);
  const forwarder = FORWARDER_WORD[feed.state] ?? "unknown";
  const rejected = feed.rejected && typeof feed.rejected === "object" ? feed.rejected : null;
  const refused = rejected === null ? null
    : Object.values(rejected).reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0);
  return [
    { id: "collector", word: feed.collector_connected === true ? "ok" : feed.collector_connected === false ? "down" : "unknown",
      heard: Number.isFinite(feed.collector_age_s), ageS: aged(feed.collector_age_s) },
    { id: "forwarder", word: forwarder, posted: Number.isFinite(feed.last_post_age_s), ageS: aged(feed.last_post_age_s),
      sent: feed.forwarder?.sent ?? null, failed: feed.forwarder?.failed ?? null },
    { id: "hub", word: feed.hub && forwarder === "ok" ? "ok" : "unknown",
      accepted: feed.hub?.accepted_packets ?? null, old: feed.hub?.old_or_duplicate_packets ?? null },
    { id: "rejected", word: refused === null ? "unknown" : refused === 0 ? "ok" : "warn", rejected },
  ];
}

/** Section 5 «Tabloda var, hiç görülmedi»: the editor list's table rows (`row_id`) whose monitor the API has never
 *  had a report of since it started (`status` null — devicebeds/listing.py), in the list's own order. */
export function neverSeenRows(body) {
  return listOf(body?.devices).filter((d) => d?.row_id != null && d.status === null);
}

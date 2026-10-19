// src/live/screens/common/monitor.js — Aşama A's monitor strip: the display rules, pure.
//
// The values are UNVALIDATED research decoding of bedside-monitor traffic (data/shadowStore.js).
// This module decides only what may be DRAWN and how old it is — never what a value means. There
// is no threshold, band or colour that depends on a value here, by declaration and by test, the
// same rule as vitals.js and freshness.js.
//
// An age is the server's `age_s` (against the API's own clock when it answered) plus the time
// since the answer arrived (this browser's clock, both ends), so a value goes old on time whether
// or not the next poll comes, and a wrong clock in this browser cannot make it look younger.
import { ageParts } from "./feedHealth.js";

/** The parameters in the API's own order (api/infinity_shadow.py PARAMETERS). */
export const PARAM_ORDER = Object.freeze(["hr", "pls", "spo2", "etco2", "temperature", "art_systolic",
  "art_diastolic", "art_mean", "respiration"]);

/** Each parameter's evidence today, and the four only partly checked — the API's own tables
 *  (api/infinity_shadow.py EVIDENCE, PARTIAL; monitor.test.js holds this copy to them). The
 *  Settings legend lists them all; a card carries its own parameters' `evidence` and `partial`. */
export const EVIDENCE = Object.freeze({
  hr: "screen_match_two_devices", pls: "screen_match_two_devices", spo2: "screen_match_two_devices",
  etco2: "screen_match_two_devices", art_systolic: "screen_match", temperature: "screen_match_site_unknown",
  art_mean: "structural", art_diastolic: "structural_trend", respiration: "range_overlap",
});
export const PARTIAL = Object.freeze(new Set(["temperature", "art_mean", "art_diastolic", "respiration"]));

/** The API sends `display_max_age_s`; this is the value it sends, for a screen that has none. */
export const DISPLAY_MAX_AGE_S = 15;

/** The wire's unit -> the board's own unit text (board.unit*), so the strip says "/dəq" as the board does. */
export const UNIT_KEY = Object.freeze({
  bpm: "board.unitBpm", "/min": "board.unitBpm", "%": "board.unitPct", mmHg: "board.unitMmhg", C: "board.unitC",
});

/** A device status that REPLACES the values with a sentence. A streaming device has none. */
export const STATUS_KEY = Object.freeze({
  standby: "monitor.standby", silent: "monitor.silent", waiting: "monitor.waiting",
  unsupported: "monitor.unsupported", unknown: "monitor.unknown",
});

const FEED_KEY = Object.freeze({
  never: "monitor.feedNever", forwarder_silent: "monitor.feedForwarder", collector_disconnected: "monitor.feedCollector",
});

/** How old a parameter is now: its age when the server answered, plus the time since. */
export function displayAge(param, nowMs, fetchedAtMs) {
  if (!Number.isFinite(param?.age_s)) return null;
  const since = Number.isFinite(nowMs) && Number.isFinite(fetchedAtMs) ? Math.max(0, nowMs - fetchedAtMs) / 1000 : 0;
  return param.age_s + since;
}

/**
 * What one parameter's cell may show:
 *   {kind: "value", value, ageS}   a number, fresh (<= maxAgeS) and valid, from a working feed
 *   {kind: "invalid", ageS}        the monitor itself shows "***"
 *   {kind: "old", ageS, lastAt}    anything else — the number is never drawn
 */
export function cellOf(param, { nowMs, fetchedAtMs, maxAgeS = DISPLAY_MAX_AGE_S, feedOk = true } = {}) {
  const ageS = displayAge(param, nowMs, fetchedAtMs);
  const fresh = feedOk && ageS !== null && ageS <= maxAgeS;
  if (fresh && param.state === "value" && Number.isFinite(param.value)) return { kind: "value", value: param.value, ageS };
  if (fresh && param.state === "invalid") return { kind: "invalid", ageS };
  return { kind: "old", ageS, lastAt: param?.last_at ?? null };
}

/** An age in the board's own words ("3 san", "2 dəq"), rounded up; null for none. */
export function ageText(t, seconds) {
  const parts = ageParts(Number.isFinite(seconds) ? seconds : null);
  if (!parts) return null;
  const key = parts.unit === "s" ? "board.ageS" : parts.unit === "m" ? "board.ageM" : "board.ageH";
  return t(key, { count: parts.value });
}

/** The chip's numbers, from the server's own counts of what this caller may see — or null when
 *  the answer carries none (a stage that is off). The caller shows them only for a read it can
 *  vouch for: the last poll answered and the feed is ok. */
export function chipCounts(data) {
  const devices = data?.feed?.devices;
  if (!devices) return null;
  return {
    total: devices.total ?? 0,
    streaming: devices.streaming ?? 0,
    silent: (devices.silent ?? 0) + (devices.waiting ?? 0) + (devices.unknown ?? 0),
    standby: devices.standby ?? 0,
    unassigned: data.feed.unassigned ?? 0,
  };
}

/** The sentence a feed in trouble says instead of counts; null when it is ok. A state this build
 *  does not know is "cannot read", never "ok". */
export function feedSentenceKey(state) {
  if (state === "ok") return null;
  return FEED_KEY[state] ?? "monitor.unreadable";
}

/** Why a bed's monitor is on no patient card; null when it is (one) or the caller may not know. */
export function linkSentenceKey(card) {
  if (card?.link === "none") return "monitor.noPatient";
  if (card?.link === "ambiguous") return card.link_reason === "two_monitors" ? "monitor.ambiguousMonitors" : "monitor.ambiguous";
  return null;
}

/** Why a device is on no bed. */
export function reasonKey(reason) {
  if (reason === "table_unassigned") return "monitor.reasonUnassigned";
  if (reason === "not_in_table") return "monitor.reasonNotInTable";
  return "monitor.reasonTable";
}

/** The newest instant a device's parameters were captured, in ms; null when it holds none. */
export function lastSeenMs(entry) {
  const stamps = (entry?.parameters ?? []).map((p) => Date.parse(p.last_at)).filter(Number.isFinite);
  return stamps.length ? Math.max(...stamps) : null;
}

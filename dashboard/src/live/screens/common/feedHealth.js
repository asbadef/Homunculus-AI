// src/live/screens/common/feedHealth.js — is the data still arriving?
//
// Taken over from the old workspace's `src/feedHealth.js`, which was written and tested and never
// connected to a screen (the project's own named failure mode). It could not simply be imported:
// roadmap D1 keeps `src/live/` off the old workspace, which G1-16 deletes. So it is copied, with
// its reasoning, and this time a screen reads it.
//
// Its reason for existing, in its author's words: on an on-prem deployment nobody can look at the
// bridge from here. A ward with no alarms and a ward whose feed died an hour ago look exactly the
// same on a board that only shows values — and the second one is the dangerous one, because
// everybody believes the bed is being watched.
//
// WHAT THESE WINDOWS ARE, AND WHAT THEY ARE NOT. `freshSec` is how often a channel is expected to
// ARRIVE — a property of the monitor and the bridge, not of the patient. It answers "is this bed
// still reporting". It is NOT a clinical validity window: nothing here colours a vital, changes a
// risk, marks a score partial or decides that a value is too old to act on. Every one of those
// belongs to the engine, which applies its own freshness inside `evaluate()` and tells us what it
// found (`Alert.stale_inputs`). Keeping the two apart is the whole discipline: a browser may say
// "this bed has stopped talking"; it may not say "this number no longer counts".
//
// The windows are still constants in a browser, which is one place too far from the hospital. They
// should come from the engine, which knows its own cadences — recorded for Group 2 ("Needs the
// user" in the Wave 3 plan).

/**
 * The channels a ward cares about, how long a gap is normal for each, and whether the channel is
 * continuous. The keys are the server's own (`api/board.py _PUBLISHED_SIGNALS`), as `measuredAt`
 * carries them.
 *
 * `continuous` is the important one. A lactate is fresh for hours by its nature — it is drawn, not
 * streamed — so its age says nothing about whether a feed is alive. Judging a bed by it would let
 * every monitor stop while a six-hour-old lab kept the bed looking connected, which is exactly the
 * failure this module exists to catch.
 *
 * `labelKey` is this build's own i18n key (the old module carried Turkish text); `source` likewise.
 */
export const CHANNELS = Object.freeze([
  { key: "heart_rate", labelKey: "board.chHr", sourceKey: "board.srcMonitor", freshSec: 300, continuous: true },
  { key: "spo2", labelKey: "board.chSpo2", sourceKey: "board.srcMonitor", freshSec: 300, continuous: true },
  { key: "sbp", labelKey: "board.chSbp", sourceKey: "board.srcMonitor", freshSec: 900, continuous: true },
  { key: "map", labelKey: "board.chMap", sourceKey: "board.srcMonitor", freshSec: 900, continuous: true },
  { key: "temperature", labelKey: "board.chTemp", sourceKey: "board.srcMonitor", freshSec: 3600, continuous: true },
  { key: "resp_rate", labelKey: "board.chRr", sourceKey: "board.srcVent", freshSec: 600, continuous: true },
  { key: "lactate", labelKey: "board.chLac", sourceKey: "board.srcLab", freshSec: 6 * 3600, continuous: false },
]);

export const STATUS = Object.freeze({
  LIVE: "live",      // arriving within its window
  STALE: "stale",    // arrived once, but not lately
  ABSENT: "absent",  // never arrived at all
});

/**
 * Seconds since a channel last reported, or null when it never has.
 *
 * An unparseable timestamp is treated as "never" rather than as "now": a bad clock must not make a
 * dead feed look alive. This project has already been bitten once by a server whose local time ran
 * an hour off the UTC stamp in its own filenames.
 */
export function ageSeconds(iso, nowMs = Date.now()) {
  if (!iso) return null;
  const when = Date.parse(iso);
  if (Number.isNaN(when)) return null;
  const seconds = (nowMs - when) / 1000;
  // A timestamp in the future is a clock problem, not freshness. Clamp rather than report a
  // negative age, and let the caller see it as fresh — the alternative is a false "stale".
  return seconds < 0 ? 0 : seconds;
}

/** One channel's state for one patient. */
export function channelHealth(channel, measuredAt, nowMs = Date.now()) {
  const age = ageSeconds(measuredAt?.[channel.key], nowMs);
  if (age === null) return { ...channel, age: null, status: STATUS.ABSENT };
  return { ...channel, age, status: age <= channel.freshSec ? STATUS.LIVE : STATUS.STALE };
}

/**
 * Every channel for one patient, plus a one-line summary.
 *
 * `absent` is reported separately from `stale` on purpose. A channel that never arrived is a wiring
 * problem — a bridge that was never connected, a device with the option switched off. A channel
 * that arrived and then stopped is a failure. They need different people.
 */
export function patientFeedHealth(patient, nowMs = Date.now()) {
  const channels = CHANNELS.map((c) => channelHealth(c, patient?.measuredAt, nowMs));
  return {
    patientId: patient?.patient_id ?? null,
    channels,
    live: channels.filter((c) => c.status === STATUS.LIVE),
    stale: channels.filter((c) => c.status === STATUS.STALE),
    absent: channels.filter((c) => c.status === STATUS.ABSENT),
    // "Silent" means no CONTINUOUS channel is arriving for this bed — the monitors and the
    // ventilator have gone quiet. Intermittent channels are excluded deliberately: a lactate drawn
    // four hours ago is legitimately fresh and would otherwise keep a bed whose monitors all
    // stopped looking connected. That is the state worth waking someone for; a missing lab is not.
    silent: channels.filter((c) => c.continuous).every((c) => c.status !== STATUS.LIVE),
  };
}

/** The whole ward, worst first — the order a biomedical engineer wants to read it in. */
export function wardFeedHealth(patients, nowMs = Date.now()) {
  const list = Array.isArray(patients) ? patients : [];
  const beds = list.map((p) => patientFeedHealth(p, nowMs));
  const rank = (b) => (b.silent ? 0 : b.stale.length ? 1 : 2);
  return {
    beds: [...beds].sort((a, b) => rank(a) - rank(b) || b.stale.length - a.stale.length),
    silentCount: beds.filter((b) => b.silent).length,
    staleCount: beds.filter((b) => !b.silent && b.stale.length > 0).length,
    healthyCount: beds.filter((b) => !b.silent && b.stale.length === 0).length,
  };
}

/** How old, as a short unit and a number: {unit, value}, or null for an age there is none of. The
 *  caller writes it with its own `t()` ("3 dk"), so the unit word is translated and the number
 *  never ends up inside a word that would need a suffix fitted to it. */
export function ageParts(seconds) {
  if (seconds === null || seconds === undefined) return null;
  if (seconds < 90) return { unit: "s", value: Math.round(seconds) };
  if (seconds < 5400) return { unit: "m", value: Math.round(seconds / 60) };
  return { unit: "h", value: Math.round(seconds / 3600) };
}

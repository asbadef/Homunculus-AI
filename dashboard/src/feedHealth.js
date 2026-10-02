// Is the data still arriving?
//
// On an on-prem deployment nobody can look at the bridge from here. A ward with no alarms and a
// ward whose feed died an hour ago look exactly the same on a board that only shows values — and
// the second one is the dangerous one, because everybody believes the bed is being watched.
//
// This module turns per-signal timestamps into an answer a biomedical engineer can act on. It is
// deliberately separate from any screen: the judgement is testable, the rendering is not.

/**
 * The channels a ward cares about, how long a gap is normal for each, and whether the channel
 * is continuous.
 *
 * `continuous` is the important one. A lactate is fresh for hours by its nature — it is drawn,
 * not streamed — so its age says nothing about whether a feed is alive. Judging a bed by it
 * would let every monitor stop while a six-hour-old lab kept the bed looking connected, which
 * is exactly the failure this module exists to catch.
 */
export const CHANNELS = [
  { key: "heart_rate",  label: "Nabız",        source: "monitör",     freshSec: 300,      continuous: true },
  { key: "spo2",        label: "SpO₂",         source: "monitör",     freshSec: 300,      continuous: true },
  { key: "sbp",         label: "Sistolik TA",  source: "monitör",     freshSec: 900,      continuous: true },
  { key: "map",         label: "MAP",          source: "monitör",     freshSec: 900,      continuous: true },
  { key: "temperature", label: "Ateş",         source: "monitör",     freshSec: 3600,     continuous: true },
  { key: "resp_rate",   label: "Solunum",      source: "ventilatör",  freshSec: 600,      continuous: true },
  { key: "lactate",     label: "Laktat",       source: "laboratuvar", freshSec: 6 * 3600, continuous: false },
];

export const STATUS = {
  LIVE: "live",        // arriving within its window
  STALE: "stale",      // arrived once, but not lately
  ABSENT: "absent",    // never arrived at all
};

/**
 * Seconds since a channel last reported, or null when it never has.
 *
 * An unparseable timestamp is treated as "never" rather than as "now": a bad clock must not
 * make a dead feed look alive. This project has already been bitten once by a server whose
 * local time ran an hour off the UTC stamp in its own filenames.
 */
export function ageSeconds(iso, now = new Date()) {
  if (!iso) return null;
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return null;
  const seconds = (now.getTime() - when.getTime()) / 1000;
  // A timestamp in the future is a clock problem, not freshness. Clamp rather than report a
  // negative age, and let the caller see it as fresh — the alternative is a false "stale".
  return seconds < 0 ? 0 : seconds;
}

/** One channel's state for one patient. */
export function channelHealth(channel, measuredAt = {}, now = new Date()) {
  const age = ageSeconds(measuredAt?.[channel.key], now);
  if (age === null) {
    return { ...channel, age: null, status: STATUS.ABSENT };
  }
  return { ...channel, age, status: age <= channel.freshSec ? STATUS.LIVE : STATUS.STALE };
}

/**
 * Every channel for one patient, plus a one-line summary.
 *
 * `absent` is reported separately from `stale` on purpose. A channel that never arrived is a
 * wiring problem — a bridge that was never connected, a device with the option switched off.
 * A channel that arrived and then stopped is a failure. They need different people.
 */
export function patientFeedHealth(patient, now = new Date()) {
  const channels = CHANNELS.map((c) => channelHealth(c, patient?.measuredAt, now));
  const stale = channels.filter((c) => c.status === STATUS.STALE);
  const absent = channels.filter((c) => c.status === STATUS.ABSENT);
  return {
    patientId: patient?.patient_id ?? null,
    bedLabel: patient?.bedLabel ?? null,
    channels,
    live: channels.filter((c) => c.status === STATUS.LIVE),
    stale,
    absent,
    // "Silent" means no CONTINUOUS channel is arriving for this bed — the monitors and the
    // ventilator have gone quiet. Intermittent channels are excluded deliberately: a lactate
    // drawn four hours ago is legitimately fresh and would otherwise keep a bed whose monitors
    // all stopped looking connected. That is the state worth waking someone for; a single
    // missing lab is not.
    silent: channels.filter((c) => c.continuous).every((c) => c.status !== STATUS.LIVE),
  };
}

/** The whole ward, worst first — the order a biomedical engineer wants to read it in. */
export function wardFeedHealth(patients = [], now = new Date()) {
  const beds = patients.map((p) => patientFeedHealth(p, now));
  const rank = (b) => (b.silent ? 0 : b.stale.length ? 1 : 2);
  return {
    beds: [...beds].sort((a, b) => rank(a) - rank(b) || b.stale.length - a.stale.length),
    silentCount: beds.filter((b) => b.silent).length,
    staleCount: beds.filter((b) => !b.silent && b.stale.length > 0).length,
    healthyCount: beds.filter((b) => !b.silent && b.stale.length === 0).length,
  };
}

/** "3 dk" / "2 sa" / "—". Short enough for a table cell, exact enough to act on. */
export function formatAge(seconds) {
  if (seconds === null || seconds === undefined) return "—";
  if (seconds < 90) return `${Math.round(seconds)} sn`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} dk`;
  return `${Math.round(seconds / 3600)} sa`;
}

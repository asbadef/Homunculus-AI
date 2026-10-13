// src/live/signals/signals.js — which waiting alarm the page sounds, and which raises a
// notification. The ONE copy of this mapping (amendments, (e)): the sound and the notification both
// read it, and signals.test.js holds it.
//
// It decides nothing clinical. It takes the alarms the board store already calls waiting
// (`alarmsToSignal`: nobody has acknowledged them, and the engine has not marked them chronic-
// expected — with the floor that keeps a downgraded critical or high waiting; an escalated one still
// waits) and maps the engine's own severity onto the three patterns the previous workspace played
// (clinicalAudio.js, its `tier` from liveAdapters.js; both readable at e4cdf15). A severity this
// build does not know sounds as critical — and so also raises the critical notification — because
// `SEVERITY_ORDER` reads it as possibly the worst; the previous workspace was silent there, and that
// is the one place this mapping departs from it.
//
// It acts on any board that holds a ward it LOADED (boardStore.js `loaded`): LIVE, DEGRADED (what
// it last had — the previous workspace's store kept its alarms when the stream dropped and went on
// sounding them), and CONNECTING once its first load has landed (the previous workspace sounded its
// first load). A board that never loaded, or whose load failed, gives nothing to play.
import { SEVERITY_ORDER, alarmsToSignal } from "../data/boardStore.js";

/** The patterns, worst first, named after the engine's severities as the previous workspace named
 *  them. Their sound is the previous workspace's (alarmSound.js), not a reviewed IEC 60601-1-8 one. */
export const PATTERNS = Object.freeze(["critical", "high", "moderate"]);

const PATTERN_OF = Object.freeze({ critical: "critical", high: "high", moderate: "moderate", low: null, info: null });

/** The pattern one alarm asks for, or null for low and info. */
export function patternOf(alarm) {
  const severity = alarm?.severity;
  return SEVERITY_ORDER.includes(severity) ? PATTERN_OF[severity] : "critical";
}

/** What the page plays now: the worst pattern among the alarms somebody must answer, or null. */
export function soundFor(board) {
  const { items } = alarmsToSignal(board ?? {});
  let worst = null;
  for (const alarm of items) {
    const pattern = patternOf(alarm);
    if (pattern && (worst === null || PATTERNS.indexOf(pattern) < PATTERNS.indexOf(worst))) worst = pattern;
  }
  return worst;
}

/** The alarms a notification is raised for — the waiting ones whose pattern is critical, as the
 *  previous workspace raised them for its CRITICAL tier only — and whether the board is LIVE
 *  (`known`): only a LIVE board may say an alarm is no longer waiting. */
export function notifyFor(board) {
  const { known, items } = alarmsToSignal(board ?? {});
  return { known, items: items.filter((alarm) => patternOf(alarm) === "critical") };
}

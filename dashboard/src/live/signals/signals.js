// src/live/signals/signals.js — which waiting alarm the page sounds, and which raises a
// notification. The ONE copy of this mapping (amendments, (e)): the sound and the notification both
// read it, and signals.test.js holds it.
//
// It decides nothing clinical. It takes the alarms the board store already calls waiting
// (`waitingAlarms`: nobody has acknowledged them, and the engine has not marked them chronic-
// expected — with the floor that keeps a downgraded critical or high waiting) and maps the engine's
// own severity onto the three patterns the previous workspace played (clinicalAudio.js, its `tier`
// from liveAdapters.js; both readable at e4cdf15). A severity this build does not know sounds as
// critical, because `SEVERITY_ORDER` reads it as possibly the worst; the previous workspace was
// silent there, and that is the one place this mapping departs from it.
import { SEVERITY_ORDER, waitingAlarms } from "../data/boardStore.js";

/** The patterns, worst first: IEC 60601-1-8's high, medium and low priority as the previous
 *  workspace named them after the engine's severities. */
export const PATTERNS = Object.freeze(["critical", "high", "moderate"]);

const PATTERN_OF = Object.freeze({ critical: "critical", high: "high", moderate: "moderate", low: null, info: null });

/** The pattern one alarm asks for, or null for low and info. */
export function patternOf(alarm) {
  const severity = alarm?.severity;
  return SEVERITY_ORDER.includes(severity) ? PATTERN_OF[severity] : "critical";
}

/** What the page plays now: the worst pattern among the alarms somebody must answer, or null.
 *  A DEGRADED board plays what it last had — the previous workspace's store kept its alarms when
 *  the stream dropped and went on sounding them; a board that cannot say what is open plays
 *  nothing (`waitingAlarms` gives it no items). */
export function soundFor(board) {
  const { items } = waitingAlarms(board ?? {});
  let worst = null;
  for (const alarm of items ?? []) {
    const pattern = patternOf(alarm);
    if (pattern && (worst === null || PATTERNS.indexOf(pattern) < PATTERNS.indexOf(worst))) worst = pattern;
  }
  return worst;
}

/** The alarms a notification is raised for — the waiting ones whose pattern is critical, as the
 *  previous workspace raised them for its CRITICAL tier only — and whether the board is LIVE
 *  (`known`): only a LIVE board may say an alarm is no longer waiting. */
export function notifyFor(board) {
  const { known, items } = waitingAlarms(board ?? {});
  return { known, items: (items ?? []).filter((alarm) => patternOf(alarm) === "critical") };
}

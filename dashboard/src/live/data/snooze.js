// src/live/data/snooze.js — «Ertele» on the dashboard (G2-B5b, spec 2026-11-10-g2b-b5b-ertele-design.md): the owner's
// rules as the screens need them, and whether an alarm is snoozed NOW.
//
// THE ENGINE DECIDES (POST /alerts/snooze). These mirror its rules only so the alarm screen offers what the engine
// takes: critical never; high at most 30 minutes; moderate at most 120; low and info none (owner D1). The dialog's
// durations are the spec's (D4): high 5/10/15/30, moderate 15/30/60/120.
//
// A SNOOZED ALARM is one whose `snooze.untilMs` is still ahead of the board's clock, and only a high or moderate one.
// A snooze on any other severity, a critical above all, is never honoured, whatever a card carries: the floor
// boardStore's `NEVER_SUPPRESSED` keeps for the chronic-expected flag. Without a clock (`nowMs` not a number), nothing
// is snoozed: an alarm the screen cannot place in time waits, and sounds.

/** The severities a snooze is honoured on. A Set, never an object lookup: a card's severity string must not reach
 *  `constructor` on a prototype. */
const SNOOZABLE = new Set(["high", "moderate"]);

/** The durations the dialog offers, by severity, each within the owner's cap. */
export const SNOOZE_CHOICES = Object.freeze({
  high: Object.freeze([5, 10, 15, 30]),
  moderate: Object.freeze([15, 30, 60, 120]),
});

/** The engine's reason codes, in the order the dialog lists them. */
export const SNOOZE_REASONS = Object.freeze([
  "CLINICAL_DECISION_MADE", "ARTEFACT_OR_SIGNAL_NOISE", "PROCEDURE_IN_PROGRESS", "PATIENT_BASELINE", "OTHER",
]);
export const OTHER = "OTHER";
/** «Diğer»'s explanation, trimmed: at least this long (the engine's rule) ... */
export const OTHER_MIN_CHARS = 15;
/** ... and no explanation longer than this. */
export const REASON_TEXT_MAX = 500;

/** May this alarm be offered «Ertele»? An unacknowledged, still-firing high or moderate one. A snoozed one may be
 *  snoozed again: the new snooze replaces the old one. */
export function maySnooze(alarm) {
  return !!alarm && !alarm.ack && alarm.status === "FIRED" && SNOOZABLE.has(alarm.severity);
}

/** Is this alarm snoozed at `nowMs`, the board's clock? */
export function isSnoozed(alarm, nowMs) {
  const until = alarm?.snooze?.untilMs;
  return Number.isFinite(nowMs) && Number.isFinite(until) && until > nowMs && SNOOZABLE.has(alarm?.severity);
}

/** The next instant after `nowMs` at which a snooze on the board ends, or null. */
export function nextSnoozeEnd(alerts, nowMs) {
  let next = null;
  for (const alarm of Array.isArray(alerts) ? alerts : []) {
    if (!isSnoozed(alarm, nowMs)) continue;
    if (next === null || alarm.snooze.untilMs < next) next = alarm.snooze.untilMs;
  }
  return next;
}

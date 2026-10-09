// src/live/screens/common/elapsed.js — how long an alarm has been open, on the WALL clock. Pure.
//
// The rule the old workspace learned the hard way (roadmap: escalationClock): a real alarm's age is
// real time since the server first saw it (`firstSeenAtMs`), never the simulation's 60x clock,
// which aged an alarm a minute per second. And the shape matters: minutes never run past 59, so
// "318:30" is written "5:18:30" — a number a clinician reads as minutes when it is hours is worse
// than no number.
//
// Negative is 0:00, and that case is real rather than theoretical: `firstSeenAtMs` is the SERVER's
// instant and the subtraction is done with the BROWSER's clock, so a ward PC a few minutes ahead of
// the API would otherwise show an alarm that has not happened yet. The limit of this: a clock that
// is wrong is still wrong — an age shown here can be out by however far the two clocks differ, and
// nothing in the board payload says what the server's time is (no sequence number, no server
// timestamp on the response). Recorded for Group 2 with the per-entry sequence number.

/** Seconds since `fromMs`, as `m:ss` under an hour and `h:mm:ss` from an hour on; `0:00` for a
 *  time that has not arrived yet. `null` when there is no instant to count from — then a screen
 *  shows nothing rather than an age it invented. */
export function elapsed(fromMs, nowMs = Date.now()) {
  if (!Number.isFinite(fromMs)) return null;
  const total = Math.max(0, Math.floor((nowMs - fromMs) / 1000));
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${ss}` : `${minutes}:${ss}`;
}

/** An ISO-8601 instant as epoch milliseconds, or null — never a fabricated time (liveAdapters'
 *  rule, repeated here because the screens read some instants straight from the payload). */
export function msOf(iso) {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

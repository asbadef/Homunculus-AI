// src/live/data/useSnoozeClock.js — the board's clock for the waiting queue (G2-B5b, spec D4, plan note 5).
//
// A snoozed alarm is out of the waiting queue (boardStore `needsAnswer`) until its `snooze.untilMs`, judged on THIS
// clock. It is the browser's clock corrected by the server's skew, `useBoardNow`'s rule. It is re-read only when it
// may matter, never on a tick:
//   - when the board's alerts change, so a card that arrives with its snooze already over is judged on the clock as
//     it is now — never on a read from before it came, not even for the instant until a timer would catch up;
//   - when the next snooze on the board ends: one timer, set for that moment but for a minute at most, so a timer the
//     browser fires late (a background tab) or loses holds the queue back by a minute at most;
//   - when the page is shown or focused again while a snooze runs, as `useNow` does.
// So the bell, the rail's count, the sound, the lock screen and the beds screen take the alarm back on time without a
// per-second re-render, and without waiting for the server's republish (the escalation cycle sends one too, within
// its interval). Between those moments the value holds still, so it is safe in an effect's dependencies.
//
// A re-read is COUNTED (`tick`), not stored as the time it read: a browser may round `Date.now()` (a guard against
// timing attacks), two reads can then return the same value, and a state set to the value it already holds renders
// nothing — the timer would never be armed again, and the alarm would stay silent.
import { useEffect, useMemo, useState } from "react";
import { useBoard } from "./BoardProvider.jsx";
import { nextSnoozeEnd } from "./snooze.js";

/** A margin past the snooze's end, so the re-read lands after it rather than a millisecond before. */
const PAST_THE_END_MS = 50;
/** The longest a timer is set for. Shorter than the browser's 32-bit limit, past which a delay fires at once. */
const MAX_WAIT_MS = 60_000;

/** The board's instant (ms) as the waiting queue should judge snoozes by. */
export function useSnoozeClock() {
  const { alerts, clockSkewMs } = useBoard();
  const skew = Number.isFinite(clockSkewMs) ? clockSkewMs : 0;
  const [tick, setTick] = useState(0);
  // Read during the render, again whenever the alerts, the skew or the tick change (see the header). `alerts` and
  // `tick` are not read inside: they say WHEN to read the clock again.
  const nowMs = useMemo(() => Date.now() + skew, [alerts, skew, tick]);
  const next = nextSnoozeEnd(alerts, nowMs);
  useEffect(() => {
    if (next === null) return undefined;
    const wait = Math.min(MAX_WAIT_MS, Math.max(0, next - (Date.now() + skew)) + PAST_THE_END_MS);
    const timer = setTimeout(() => setTick((n) => n + 1), wait);
    return () => clearTimeout(timer);
  }, [next, skew, nowMs, tick]);
  // The page's return, only while a snooze runs: with none, there is nothing a fresh read could change.
  const running = next !== null;
  useEffect(() => {
    if (!running) return undefined;
    const wake = () => {
      if (document.visibilityState !== "hidden") setTick((n) => n + 1);
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    return () => {
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
    };
  }, [running]);
  return nowMs;
}

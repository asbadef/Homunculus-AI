// src/live/data/useSnoozeClock.js — the board's clock for the waiting queue (G2-B5b, spec D4, plan note 5).
//
// A snoozed alarm is out of the waiting queue (boardStore `needsAnswer`) until its `snooze.untilMs`, judged on THIS
// clock. It is the browser's clock corrected by the server's skew, `useBoardNow`'s rule. It is re-read only the moment
// the next snooze on the board ends: one timer, not a tick. So the bell, the rail's count, the sound, the lock screen
// and the beds screen take the alarm back on time without a per-second re-render, and without waiting for the
// server's republish (the escalation cycle sends one too, within its interval). Between those moments the value
// holds still, so it is safe in an effect's dependencies.
import { useEffect, useState } from "react";
import { useBoard } from "./BoardProvider.jsx";
import { nextSnoozeEnd } from "./snooze.js";

/** A margin past the snooze's end, so the re-read lands after it rather than a millisecond before. */
const PAST_THE_END_MS = 50;
/** The longest delay a timer keeps; a longer one would fire at once (the browser's 32-bit limit). */
const MAX_TIMER_MS = 2_147_483_647;

/** The board's instant (ms) as the waiting queue should judge snoozes by. */
export function useSnoozeClock() {
  const { alerts, clockSkewMs } = useBoard();
  const skew = Number.isFinite(clockSkewMs) ? clockSkewMs : 0;
  const [readAt, setReadAt] = useState(() => Date.now());
  const nowMs = readAt + skew;
  const next = nextSnoozeEnd(alerts, nowMs);
  useEffect(() => {
    if (next === null) return undefined;
    const wait = Math.min(MAX_TIMER_MS, Math.max(0, next - (Date.now() + skew)) + PAST_THE_END_MS);
    const timer = setTimeout(() => setReadAt(Date.now()), wait);
    return () => clearTimeout(timer);
  }, [next, skew, readAt]);
  return nowMs;
}

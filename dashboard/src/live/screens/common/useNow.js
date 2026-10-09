// src/live/screens/common/useNow.js — the wall clock, re-read on a cadence. For ages, not for data.
//
// Re-armed with a timeout rather than an interval (the top bar's Clock does the same): an interval
// that fires while the page is throttled queues up and then runs several times at once, and a ward
// PC left open all night should not wake once a second to repaint the same digits. So the tick is
// skipped while the tab is hidden and taken again the moment it comes back — which is also when a
// clinician looks at it.
//
// Nothing clinical depends on this. A value's own age comes from the server's timestamp; this is
// only what the subtraction is done against. The old workspace's `useNow` carried the same warning
// for the opposite reason: the simulation's clock ran at 60x and would age a real alarm a minute
// per second.
import { useEffect, useState } from "react";

/** The current instant, refreshed every `ms` while the page is visible. `ms` null: read once. */
export function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!Number.isFinite(ms) || ms <= 0) return undefined;
    let timer = 0;
    const hidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";
    const arm = () => {
      // Line up on the cadence rather than on the mount, so every card on the screen changes at
      // the same moment and a minute's display is never a fraction behind the wall clock.
      timer = setTimeout(tick, ms - (Date.now() % ms));
    };
    const tick = () => {
      if (!hidden()) setNow(Date.now());
      arm();
    };
    const wake = () => {
      if (!hidden()) setNow(Date.now());
    };
    arm();
    document.addEventListener("visibilitychange", wake);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [ms]);
  return now;
}

// src/live/screens/isyuku/useShiftEnd.js — G4-04 «İş yükü» (review 7): the page reads again when its shift ends.
//
// The 60 s poll would catch the change of shift within a minute; this sets one timer for the moment the window the
// page holds ends, on the server's clock (this browser's corrected by the skew the API client measured on its latest
// answer — the server decides which window is current), a few seconds past it so the read lands in the new window.
// A new window (the next read's) re-arms it; the page's going clears it. A window already over fires at once: the
// page says «nöbet değişti, yenileniyor», and this is that read.
import { useEffect, useRef } from "react";

/** A margin past the end, so the read lands after the change of shift rather than a moment before it — clear of the
 *  2 s under which the API client reports the skew as 0 (backendApi SKEW_NOISE_MS): a browser up to 2 s ahead of the
 *  server looks right to it (re-review 1). */
export const PAST_THE_END_MS = 5_000;

/** Calls `onEnd` once, PAST_THE_END_MS after `endMs` (a server instant) on the server's clock (`Date.now() + skewMs`;
 *  an unknown skew is 0). Nothing is armed without an `endMs`. The newest `onEnd` is the one called. */
export function useShiftEnd({ endMs, skewMs, onEnd }) {
  const latest = useRef(onEnd);
  useEffect(() => { latest.current = onEnd; });
  const skew = Number.isFinite(skewMs) ? skewMs : 0;
  useEffect(() => {
    if (!Number.isFinite(endMs)) return undefined;
    const wait = Math.max(0, endMs - (Date.now() + skew)) + PAST_THE_END_MS;
    const timer = setTimeout(() => { latest.current(); }, wait);
    return () => clearTimeout(timer);
  }, [endMs, skew]);
}

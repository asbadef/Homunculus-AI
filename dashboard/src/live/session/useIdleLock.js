// src/live/session/useIdleLock.js — lock the screen after the hospital's idle time.
//
// Idle = no key press, click, touch or wheel in ANY tab of this browser for `minutes` (the
// API's SCREEN_LOCK_IDLE_MINUTES, from /auth/me). A pointer that only moves does not count: a
// mouse bumped on a cart must not keep a ward PC open. The last activity is shared through
// browserState (hmc.activeAt, written at most every SHARE_EVERY_MS), so a tab in the background
// does not lock the one in use. WARN_SECONDS before the lock, `secondsLeft` counts down for the
// warning; `stay()` (its button) is activity.
import { useCallback, useEffect, useRef, useState } from "react";
import { readActiveAt, writeActiveAt } from "./browserState.js";

export const WARN_SECONDS = 60;
export const SHARE_EVERY_MS = 5000;
export const ACTIVITY_EVENTS = Object.freeze(["keydown", "pointerdown", "wheel", "touchstart"]);

export function useIdleLock({ minutes, onIdle, enabled = true }) {
  const [secondsLeft, setSecondsLeft] = useState(null);
  const last = useRef(Date.now());
  const shared = useRef(0);
  const idle = useRef(onIdle);
  idle.current = onIdle;

  const touch = useCallback(() => {
    const now = Date.now();
    last.current = now;
    if (now - shared.current >= SHARE_EVERY_MS) {
      shared.current = now;
      writeActiveAt(now);
    }
  }, []);

  const stay = useCallback(() => {
    shared.current = 0;                        // share it now: the warning is a deliberate act
    touch();
    setSecondsLeft(null);
  }, [touch]);

  useEffect(() => {
    if (!enabled) return undefined;
    last.current = Date.now();
    const options = { capture: true, passive: true };
    for (const type of ACTIVITY_EVENTS) document.addEventListener(type, touch, options);
    const limit = minutes * 60_000;
    const tick = () => {
      // Another tab's activity counts only up to now: a time still to come (a clock stepped back,
      // a value typed into storage) is no activity at all. Capped at now instead, it would read as
      // "active this very second" at every tick, and the screen would never lock.
      const others = readActiveAt();
      const latest = Math.max(last.current, others !== null && others <= Date.now() ? others : 0);
      const left = Math.ceil((limit - (Date.now() - latest)) / 1000);
      if (left <= 0) {
        setSecondsLeft(null);
        last.current = Date.now();               // once per idle period, not every second
        idle.current();
      } else {
        setSecondsLeft(left <= WARN_SECONDS ? left : null);
      }
    };
    const timer = setInterval(tick, 1000);
    return () => {
      clearInterval(timer);
      for (const type of ACTIVITY_EVENTS) document.removeEventListener(type, touch, options);
      setSecondsLeft(null);
    };
  }, [enabled, minutes, touch]);

  return { secondsLeft, stay };
}

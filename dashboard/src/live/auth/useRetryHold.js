// src/live/auth/useRetryHold.js — hold a form's submit for the seconds a 429 said to wait
// (`err.retryAfter`, backendApi.js: nginx's Retry-After, at most RETRY_AFTER_MAX_S).
//
//   const { wait, holding, hold, current } = useRetryHold();
//   hold(err.retryAfter)   begins (or restarts) a hold of that many seconds, from now; a number
//                          that is not above zero (0, a negative, undefined) starts no hold at all
//   wait                   whole seconds left (ceil), 0 when there is no hold
//   holding                wait > 0: the submit button is disabled meanwhile
//   current                { since, seconds, deadline } of the hold, a new object per hold — the key
//                          for anything said ONCE per hold (the form's announcement); null before any
//
// The count is the clock's, not the timer's: each tick reads Date.now() against the deadline, so a
// tab the browser throttled or a laptop that slept does not stretch a 60-second hold into minutes;
// the page becoming visible again recomputes at once, and a deadline passed while asleep releases
// on waking without a tick. Ticks land on the second boundaries, so the number changes exactly on
// time. Timers are cleared on unmount and on the next hold.
//
// Used by the password form (Task 18) and the sign-in form (Task 19): both show the count with
// aria-hidden and announce it once — see PasswordForm.jsx for the pattern.
import { useCallback, useEffect, useState } from "react";

const secondsLeft = (deadline) => Math.max(0, Math.ceil((deadline - Date.now()) / 1000));

export function useRetryHold() {
  const [current, setCurrent] = useState(null);
  const [wait, setWait] = useState(0);

  useEffect(() => {
    if (!current) return undefined;
    let timer = null;
    const tick = () => {
      timer = null;
      // Never more than the hold the server asked for: a PC clock stepped backwards (NTP) must not
      // stretch a 60-second refusal into minutes of a disabled button.
      const left = Math.min(current.seconds, secondsLeft(current.deadline));
      setWait(left);
      if (left === 0) return;
      // To the next second boundary (never 0 ms: a deadline exactly on one waits a full second).
      timer = setTimeout(tick, ((current.deadline - Date.now()) % 1000) || 1000);
    };
    const recompute = () => {
      if (timer !== null) clearTimeout(timer);
      tick();
    };
    tick();
    document.addEventListener("visibilitychange", recompute);
    return () => {
      if (timer !== null) clearTimeout(timer);
      document.removeEventListener("visibilitychange", recompute);
    };
  }, [current]);

  const hold = useCallback((seconds) => {
    if (!(seconds > 0)) return;              // nothing to wait for: no hold, and nothing to announce
    const since = Date.now();
    setCurrent({ since, seconds, deadline: since + seconds * 1000 });
    setWait(seconds);                        // held from this render on, before the effect's first tick
  }, []);

  return { wait, holding: wait > 0, hold, current };
}

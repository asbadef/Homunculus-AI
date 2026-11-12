// src/live/data/UnmatchedProvider.jsx — the unmatched readings, read once for the whole shell (G3-05, D17): the
// rail's badge on «Yatak başı ölçüm» and that page's «Eşleşmeyen ölçümler» step read the same answer
// (GET /readings/unmatched; homunculus-engine api/readings.py).
//
//   const { sets, count, truncated, phase, error, reload } = useUnmatched();
//
// `phase`: "unasked" (this session does not hold `clinical.chart`, so the route is not called), "loading", "known",
// "stale" (a read failed; the last sets stand) or "failed" (none has answered). `count` is the number of waiting
// SETS as the ENGINE counts them (its `count`: the answer carries at most the newest 200 sets, so `sets.length` is
// not the count — final review, minor 7), and only from a read that succeeded: in every other phase it is null — a
// number that may be out of date is not a count, and the badge shows nothing rather than a number the ward would take
// for current. `truncated` is the engine's word that `sets` is short of what waits (the step says so beside them).
// `reload()` reads now and resolves to the sets it read (null when the read failed or was not asked): the step calls
// it after a link or a rejection. Every call goes through the session's `track`, as the board's do.
// Outside a provider (a screen mounted alone in a test) the context is empty: nothing is called.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "../session/SessionProvider.jsx";

/** D17: the list is polled every 60 seconds. */
export const UNMATCHED_POLL_MS = 60_000;
/** The right the three routes ask for (api/readings.py CLINICAL_CHART). */
export const UNMATCHED_PERM = "clinical.chart";

const NONE = Object.freeze({
  sets: Object.freeze([]), count: null, truncated: false, phase: "unasked", error: null, reload: async () => null,
});
const UnmatchedContext = createContext(NONE);

/** The engine's count of the waiting sets; an answer without one (an older engine) is counted by its sets. */
const countOf = (answer) => (Number.isInteger(answer.count) && answer.count >= 0 ? answer.count : answer.sets.length);

export function UnmatchedProvider({ children }) {
  const { user, store } = useSession();
  const may = user?.perms?.includes(UNMATCHED_PERM) ?? false;
  const [state, setState] = useState(() => ({
    sets: null, count: null, truncated: false, phase: may ? "loading" : "unasked", error: null,
  }));
  const seq = useRef(0);
  const mounted = useRef(false);

  const reload = useCallback(async () => {
    // Every call takes a number first: an answer overtaken by a later read is dropped.
    const mine = seq.current + 1;
    seq.current = mine;
    if (!may) {
      setState({ sets: null, count: null, truncated: false, phase: "unasked", error: null });
      return null;
    }
    try {
      const answer = await store.track(() => store.api.unmatchedReadings());
      if (!answer || !Array.isArray(answer.sets)) throw new Error("not an unmatched list");
      if (mounted.current && seq.current === mine) {
        setState({ sets: answer.sets, count: countOf(answer), truncated: answer.truncated === true, phase: "known",
          error: null });
      }
      return answer.sets;
    } catch (error) {
      if (error?.superseded) return null;
      if (mounted.current && seq.current === mine) {
        // The last sets stand, and with them the word on whether they were all of them.
        setState((prev) => ({ ...prev, phase: prev.sets ? "stale" : "failed", error }));
      }
      return null;
    }
  }, [may, store]);

  useEffect(() => {
    mounted.current = true;
    reload();
    const timer = may ? setInterval(reload, UNMATCHED_POLL_MS) : 0;
    return () => {
      mounted.current = false;
      seq.current += 1;          // a read in flight lands nowhere
      clearInterval(timer);
    };
  }, [reload, may]);

  const value = useMemo(() => ({
    sets: state.sets ?? NONE.sets,
    count: state.phase === "known" ? state.count : null,
    truncated: state.sets ? state.truncated : false,
    phase: state.phase, error: state.error, reload,
  }), [state, reload]);
  return <UnmatchedContext.Provider value={value}>{children}</UnmatchedContext.Provider>;
}

/** The unmatched readings as the shell holds them. */
export const useUnmatched = () => useContext(UnmatchedContext);

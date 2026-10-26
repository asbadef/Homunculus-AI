// src/live/screens/kabul/useAdmissions.js — the admissions of the caller's units in some states
// (GET /admissions, Group 2 · B1a). The Taburcu tab, the sign-off strip and the bed card's badge
// read it.
//
//   const { rows, phase, error, reload } = useAdmissions(["DRAFT", "ACTIVE"]);
//
// `phase` as the structure's: "unasked" (no `admissions.view` — not called), "loading", "known",
// "stale" (a reload failed, the last rows stand), "failed". `truncated`: the rows on screen are a
// list the server cut at its cap (backendApi `admissions`, A-30). `every` (ms) reads again on a timer
// while mounted; a read answered after a newer one began is dropped. Through the session's `track`.
//
// `reload()` resolves once the list on screen is AT LEAST AS NEW as the read it began — not merely
// once its own request has answered. A read overtaken by a newer one (the minute's timer, another
// write's re-read) has its rows dropped, so a caller that holds a button until the list is read
// again after its write waits for the newer read instead: freed on the overtaken answer, the button
// would stand over the list from before the write, and a second press would repeat it (A-22).
import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "../../session/SessionProvider.jsx";

export function useAdmissions(states, { every = 0 } = {}) {
  const { user, store } = useSession();
  const may = user?.perms?.includes("admissions.view") ?? false;
  const wanted = states.join(",");
  const [state, setState] = useState(() => ({ rows: null, phase: may ? "loading" : "unasked", error: null, truncated: false }));
  const seq = useRef(0);
  const latest = useRef(null);                       // the newest read begun: what an overtaken one waits for
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const reload = useCallback(async () => {
    if (!may) return;
    const mine = seq.current + 1;
    seq.current = mine;
    const read = (async () => {
      try {
        const rows = await store.track(() => store.api.admissions(wanted ? wanted.split(",") : []));
        if (mounted.current && seq.current === mine) {
          setState({ rows: Array.isArray(rows) ? rows : [], phase: "known", error: null, truncated: rows?.truncated === true });
        }
      } catch (error) {
        if (mounted.current && seq.current === mine) {
          // The rows that stand are the last read's, and so is what it said of their cut.
          setState((prev) => ({ ...prev, phase: prev.rows ? "stale" : "failed", error }));
        }
      }
    })();
    latest.current = read;
    // A read never rejects (it says its failure in `phase`), so this only waits.
    let waited = read;
    await waited;
    while (latest.current !== waited) {
      waited = latest.current;
      await waited;                                  // eslint-disable-line no-await-in-loop
    }
  }, [may, store, wanted]);

  useEffect(() => {
    reload();
    if (!every) return undefined;
    const timer = setInterval(reload, every);
    return () => clearInterval(timer);
  }, [reload, every]);

  return { ...state, reload };
}

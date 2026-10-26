// src/live/screens/kabul/useAdmissions.js — the admissions of the caller's units in some states
// (GET /admissions, Group 2 · B1a). The Taburcu tab, the sign-off strip and the bed card's badge
// read it.
//
//   const { rows, phase, error, reload } = useAdmissions(["DRAFT", "ACTIVE"]);
//
// `phase` as the structure's: "unasked" (no `admissions.view` — not called), "loading", "known",
// "stale" (a reload failed, the last rows stand), "failed". `every` (ms) reads again on a timer
// while mounted; a read answered after a newer one began is dropped. Through the session's `track`.
import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "../../session/SessionProvider.jsx";

export function useAdmissions(states, { every = 0 } = {}) {
  const { user, store } = useSession();
  const may = user?.perms?.includes("admissions.view") ?? false;
  const wanted = states.join(",");
  const [state, setState] = useState(() => ({ rows: null, phase: may ? "loading" : "unasked", error: null }));
  const seq = useRef(0);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const reload = useCallback(async () => {
    if (!may) return;
    const mine = seq.current + 1;
    seq.current = mine;
    try {
      const rows = await store.track(() => store.api.admissions(wanted ? wanted.split(",") : []));
      if (mounted.current && seq.current === mine) {
        setState({ rows: Array.isArray(rows) ? rows : [], phase: "known", error: null });
      }
    } catch (error) {
      if (mounted.current && seq.current === mine) {
        setState((prev) => ({ rows: prev.rows, phase: prev.rows ? "stale" : "failed", error }));
      }
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

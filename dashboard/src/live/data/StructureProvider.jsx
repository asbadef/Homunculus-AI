// src/live/data/StructureProvider.jsx — the ward's structure, read once for the whole shell
// (Group 2 · B1a). The top bar and the bed board read a unit's NAME from it, the admission screen
// its beds and their states, the administrator's Yapı tab the whole tree.
//
//   const { structure, index, phase, reload } = useStructure();
//
// `phase`: "unasked" (this session holds none of the rights `GET /tenant/structure` opens to, so
// it is not called), "loading", "known", "stale" (a reload failed; the last answer stands), or
// "failed" (none has answered). Every call goes through the session's `track`, as the board's do.
// `reload()` resolves to the tree it read — null when that read failed or was not asked — so a
// screen that must decide on a FRESH answer (Kabul, after a write that got no answer) decides on
// that one, not on whatever its next render happens to hold.
// Outside a provider (a screen mounted alone in a test) the context is empty: every name falls
// back as `unitLabel` says, and nothing is called.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "../session/SessionProvider.jsx";
import { EMPTY_INDEX, indexStructure } from "./structure.js";

/** The rights GET /tenant/structure opens to (tenant/router.py) — the scope editor's
 *  `users.manage` among them. */
export const STRUCTURE_PERMS = Object.freeze(["admissions.view", "admissions.admit", "beds.release", "structure.manage", "users.manage"]);

const NONE = Object.freeze({ structure: null, index: EMPTY_INDEX, phase: "unasked", error: null, reload: async () => null });
const StructureContext = createContext(NONE);

export function StructureProvider({ children }) {
  const { user, store } = useSession();
  const may = STRUCTURE_PERMS.some((key) => user?.perms?.includes(key));
  const [state, setState] = useState(() => ({ structure: null, phase: may ? "loading" : "unasked", error: null }));
  const seq = useRef(0);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const reload = useCallback(async () => {
    if (!may) {
      setState({ structure: null, phase: "unasked", error: null });
      return null;
    }
    const mine = seq.current + 1;
    seq.current = mine;
    try {
      const answer = await store.track(() => store.api.structure());
      // An answer that is not a tree is an empty one, still "known": the server answered.
      const tree = Array.isArray(answer?.sites) ? answer : { tenant_id: answer?.tenant_id ?? null, sites: [] };
      if (mounted.current && seq.current === mine) setState({ structure: tree, phase: "known", error: null });
      return tree;
    } catch (error) {
      if (mounted.current && seq.current === mine) {
        setState((prev) => ({ structure: prev.structure, phase: prev.structure ? "stale" : "failed", error }));
      }
      return null;
    }
  }, [may, store]);

  useEffect(() => { reload(); }, [reload]);

  const value = useMemo(() => ({
    structure: state.structure, index: indexStructure(state.structure), phase: state.phase,
    error: state.error, reload,
  }), [state, reload]);
  return <StructureContext.Provider value={value}>{children}</StructureContext.Provider>;
}

export function useStructure() {
  return useContext(StructureContext);
}

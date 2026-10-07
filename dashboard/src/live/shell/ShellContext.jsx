// src/live/shell/ShellContext.jsx — what the shell holds for its screens.
//
//   const { unit, setUnit, units, stale } = useShell();
// `units`: the units the engine scoped this session to, when two or more (boardStore.scopeUnits);
// `unit`: the one the top bar's chip picked, or null for all of them. G1-09's bed board filters by
// it. Held in memory only: it goes with the session (the shell unmounts on sign-out and lock).
//
// `scope` says what the shell knows about the engine's scope right now, which is three things and
// not two:
//   "known"  the engine sent it: `units` is it, and a unit it no longer lists is dropped.
//   "stale"  a /patients load FAILED. That is not the same as "this session has no units": read
//            that way, a five-second hiccup in the ward's network emptied the chip and took the
//            clinician's choice with it — and in Wave 3 it would silently widen a one-unit bed
//            board to her whole scope. The last list the engine did send is offered and the
//            choice stands, and `stale` says so on the chip: under repeated failures a unit the
//            engine has since revoked must not stand there with nothing said.
//   "none"   nothing has been loaded, or the board was emptied (a session that may not see it at
//            all): there is nothing to offer and no choice to keep.
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

const NONE = Object.freeze([]);
const ShellContext = createContext({ unit: null, setUnit: () => {}, units: NONE, stale: false });

export function ShellProvider({ units, scope = "known", children }) {
  const [unit, setUnit] = useState(null);
  const [offered, setOffered] = useState(units);
  const stale = scope === "stale";
  useEffect(() => {
    if (scope === "known") {
      setOffered(units);
      if (unit !== null && !units.includes(unit)) setUnit(null);  // the engine dropped it
    } else if (scope === "none") {
      setOffered(NONE);                                           // no scope at all any more
      setUnit(null);
    }
  }, [scope, units, unit]);
  const value = useMemo(() => ({
    // A scope we have and that no longer lists the choice drops it at once (the effect above then
    // forgets it); while it is only out of date, the choice stands.
    unit: stale || offered.includes(unit) ? unit : null,
    setUnit,
    units: offered,
    stale,
  }), [stale, offered, unit]);
  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

export function useShell() {
  return useContext(ShellContext);
}

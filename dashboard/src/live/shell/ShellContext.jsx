// src/live/shell/ShellContext.jsx — what the shell holds for its screens.
//
//   const { unit, setUnit, units } = useShell();
// `units`: the units the engine scoped this session to, when two or more (boardStore.scopeUnits);
// `unit`: the one the top bar's chip picked, or null for all of them. G1-09's bed board filters by
// it. Held in memory only: it goes with the session (the shell unmounts on sign-out and lock).
//
// `known` says whether the scope those units came from is one the engine actually sent. A
// /patients load that FAILED leaves the scope unknown, which is not the same as "this session has
// no units": read that way, a five-second hiccup in the ward's network emptied the chip and took
// the clinician's choice with it — and in Wave 3 that would silently widen a one-unit bed board to
// her whole scope. So while the scope is unknown the last list the engine did send is offered and
// the choice stands; only a scope we HAVE may take a unit away, by no longer listing it.
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

const ShellContext = createContext({ unit: null, setUnit: () => {}, units: [] });

export function ShellProvider({ units, known = true, children }) {
  const [unit, setUnit] = useState(null);
  const [offered, setOffered] = useState(units);
  useEffect(() => {
    if (!known) return;                                        // the scope says nothing right now
    setOffered(units);
    if (unit !== null && !units.includes(unit)) setUnit(null);  // the engine dropped it from the scope
  }, [known, units, unit]);
  const value = useMemo(() => ({
    // A scope we have and that no longer lists the choice drops it at once (the effect above then
    // forgets it); while it is unknown, the choice stands.
    unit: !known || offered.includes(unit) ? unit : null,
    setUnit,
    units: offered,
  }), [known, offered, unit]);
  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

export function useShell() {
  return useContext(ShellContext);
}

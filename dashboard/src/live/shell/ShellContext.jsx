// src/live/shell/ShellContext.jsx — what the shell holds for its screens.
//
//   const { unit, setUnit, units } = useShell();
// `units`: the units the engine scoped this session to, when two or more (boardStore.scopeUnits);
// `unit`: the one the top bar's chip picked, or null for all of them. G1-09's bed board filters by
// it. Held in memory only: it goes with the session (the shell unmounts on sign-out and lock).
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

const ShellContext = createContext({ unit: null, setUnit: () => {}, units: [] });

export function ShellProvider({ units, children }) {
  const [unit, setUnit] = useState(null);
  useEffect(() => {
    if (unit !== null && !units.includes(unit)) setUnit(null);   // the scope changed under it
  }, [unit, units]);
  const value = useMemo(() => ({ unit: units.includes(unit) ? unit : null, setUnit, units }), [unit, units]);
  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

export function useShell() {
  return useContext(ShellContext);
}

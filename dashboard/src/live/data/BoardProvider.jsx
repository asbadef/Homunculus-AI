// src/live/data/BoardProvider.jsx — the board store (boardStore.js) for React.
//
//   const { patients, alerts, connection, scope, scopeNote, store } = useBoard();
// Wave 3's screens (beds, alarms, patient) read the ward from here. The shell reads it through the
// store's summaries, which carry Decision 18 (`known` only when LIVE, `stale` when DEGRADED, null
// numbers otherwise): the bell through `waitingAlarms(useBoard())`, the lock screen through
// `lockSummary(useBoard())` and NOTHING else — numbers only, no name or bed on a locked screen.
// LiveApp starts the store for a session that may see the board and clears it when it ends.
import React, { createContext, useContext, useSyncExternalStore } from "react";

const BoardContext = createContext(null);

export function BoardProvider({ store, children }) {
  return <BoardContext.Provider value={store}>{children}</BoardContext.Provider>;
}

export function useBoard() {
  const store = useContext(BoardContext);
  if (!store) throw new Error("useBoard: no <BoardProvider> above this component");
  const state = useSyncExternalStore(store.subscribe, store.getState);
  return { ...state, store };
}

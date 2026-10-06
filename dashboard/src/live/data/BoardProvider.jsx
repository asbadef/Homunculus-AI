// src/live/data/BoardProvider.jsx — the board store (boardStore.js) for React.
//
//   const { patients, alerts, connection, scope, scopeNote, store } = useBoard();
// Wave 3's screens (beds, alarms, patient) read the ward from here; the shell reads it for the bell
// and the lock screen's counts. LiveApp starts the store for a session that may see the board and
// clears it when the session ends.
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

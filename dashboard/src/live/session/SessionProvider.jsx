// src/live/session/SessionProvider.jsx — the session store (sessionStore.js) for React.
//
//   const { phase, user, notice, lock, store } = useSession();
// The component re-renders when the session changes; `store` carries the actions (signIn,
// verifyMfa, changePassword, lock, unlock, signOut, track…).
import React, { createContext, useContext, useSyncExternalStore } from "react";

const SessionContext = createContext(null);

export function SessionProvider({ store, children }) {
  return <SessionContext.Provider value={store}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const store = useContext(SessionContext);
  if (!store) throw new Error("useSession: no <SessionProvider> above this component");
  const state = useSyncExternalStore(store.subscribe, store.getState);
  return { ...state, store };
}

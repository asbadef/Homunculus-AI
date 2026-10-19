// src/live/data/ShadowProvider.jsx — the shadow store (shadowStore.js) for React: Aşama A's
// unvalidated monitor strip.
//
//   const { phase, stage, data, fetchedAtMs, nowMs } = useShadow();
//
// A component that calls `useShadow()` IS a consumer: mounting it starts the polling (the first
// one), unmounting it stops it (the last one). LiveApp mounts the provider around the phases only —
// never around AlarmSignals — and starts the store only while the session is READY, so nothing of
// the strip exists on the lock screen or in an alarm path (boundaries.test.js).
//
// `nowMs` ticks every second, on THIS browser's clock and on purpose: a strip age is the server's
// `age_s` (taken against the API's own clock when it answered) plus the time since `fetchedAtMs`
// (this browser's clock, both ends) — a difference of two readings of one clock, which a wrong
// clock cannot skew. That is why this is not `useBoardNow`, which corrects a SERVER instant.
import React, { createContext, useContext, useEffect, useSyncExternalStore } from "react";
import { useNow } from "../screens/common/useNow.js";

const ShadowContext = createContext(null);

export function ShadowProvider({ store, children }) {
  return <ShadowContext.Provider value={store}>{children}</ShadowContext.Provider>;
}

/** The strip's state, and a 1 s clock to age it by. Mounting this is asking for the strip. */
export function useShadow() {
  const store = useContext(ShadowContext);
  if (!store) throw new Error("useShadow: no <ShadowProvider> above this component");
  useEffect(() => {
    store.acquire();
    return () => store.release();
  }, [store]);
  const state = useSyncExternalStore(store.subscribe, store.getState);
  const tick = useNow(1000);
  // An answer lands between two ticks, so the last tick is older than its `fetchedAtMs`: aged by
  // the tick, every fresh read would be in the future — unknown — for up to a second after each
  // poll. The clock is read again then; only a clock that really went back stays behind the read.
  const nowMs = Number.isFinite(state.fetchedAtMs) && tick < state.fetchedAtMs ? Date.now() : tick;
  return { ...state, nowMs, store };
}

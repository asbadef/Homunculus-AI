// src/live/screens/eczane/usePharmacy.js — reads GET /pharmacy on mount and every 30 s (G3-04, spec D17), in the
// shape of gorevler/useTasks.js. A failed read keeps the last answer and reports the error: the screen then says
// the list is not fresh, and never calls it empty (spec D18, §6). An answer without a `rows` array is a failed
// read (`error.malformed`), never an empty ward. The tab shown again reads at once: a list read before the tab was
// hidden is not fresh, and the pharmacist should not wait a whole tick for today's.
import { useCallback, useEffect, useRef, useState } from "react";

export const PHARMACY_TICK_MS = 30_000;

const hidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";
const malformed = () => Object.assign(new Error(""), { malformed: true });

export function usePharmacy(store, { everyMs = PHARMACY_TICK_MS } = {}) {
  const [state, setState] = useState({ data: null, error: null });
  const alive = useRef(true);
  //: the sequence of the latest read issued; an answer to an earlier one is dropped, so the screen never shows
  //: an older list over a newer one (useTasks)
  const seq = useRef(0);
  const read = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const data = await store.track(() => store.api.pharmacy());
      if (!data || !Array.isArray(data.rows)) throw malformed();
      if (alive.current && mine === seq.current) setState({ data, error: null });
    } catch (error) {
      if (alive.current && mine === seq.current) setState((s) => ({ data: s.data, error }));
    }
  }, [store]);
  useEffect(() => {
    alive.current = true;
    read();
    const id = setInterval(read, everyMs);
    const wake = () => { if (!hidden()) read(); };
    document.addEventListener("visibilitychange", wake);
    return () => {
      alive.current = false;
      clearInterval(id);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [read, everyMs]);
  return { data: state.data, error: state.error, refresh: read };
}

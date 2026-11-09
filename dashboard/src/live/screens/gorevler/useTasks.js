// src/live/screens/gorevler/useTasks.js — reads /tasks every 30 s and after every write (G3-02 D14).
// A failed read keeps the last answer and reports the error; the screen says so and goes on.
import { useCallback, useEffect, useRef, useState } from "react";

export const TASKS_TICK_MS = 30_000;

export function useTasks(store, { everyMs = TASKS_TICK_MS } = {}) {
  const [state, setState] = useState({ data: null, error: null });
  const alive = useRef(true);
  //: the sequence of the latest read issued; an answer to an earlier one (a slow tick overtaken by the
  //: re-read after a write) is dropped, so the screen never shows an older queue over a newer one
  const seq = useRef(0);
  const read = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const data = await store.track(() => store.api.tasks());
      if (alive.current && mine === seq.current) setState({ data, error: null });
    } catch (error) {
      if (alive.current && mine === seq.current) setState((s) => ({ data: s.data, error }));
    }
  }, [store]);
  useEffect(() => {
    alive.current = true;
    read();
    const id = setInterval(read, everyMs);
    return () => { alive.current = false; clearInterval(id); };
  }, [read, everyMs]);
  /** Runs a write through the session store — `call(api)` receives the session's API — then reads again.
   *  Rejections propagate to the caller. */
  const write = useCallback(async (call) => {
    const answer = await store.track(() => call(store.api));
    await read();
    return answer;
  }, [store, read]);
  return { data: state.data, error: state.error, refresh: read, write };
}

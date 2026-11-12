// src/live/screens/ozet/useSummaryReads.js — G4-02 «Yönetici özeti» (spec D5): the page's own reads.
//
// `useSummaryReads`: the tree (through the shell's StructureProvider — every screen keeps the one tree), `/tasks`,
// `/handovers/pending` and the caller's own scope (`/scope/me`, which every signed-in user may read: the units table's
// reach, ozet.js `reachSource`), read when the page opens, on «Yenile», and every SUMMARY_POLL_MS while the page is
// visible (and at once when it is shown again). G4-04: `extra` — `{may, read(api), valid, full?}` — is one more read of
// another page's in the same round («İş yükü»: GET /shift-schedule, then /tasks over its shift), answered as `extra`.
// A read that fails keeps nothing of its last answer: the page says
// «okunamadı», never an older number as today's. `fullAt`: when the last round in which every source this session may
// read answered came back — the header's «HH:MM itibarıyla».
//
// `useQuality`: `/alarm-quality` for one period, read when the page opens and when the period changes — never on a
// timer (spec D5 §3: the API rebuilds every episode of the window from the audit trail) — and again on «Yeniden dene»
// (`retry`, a user's action after a failure). The newest read wins.
//
// An answer of the wrong shape — one malformed entry is enough — is a failed read, never a partial count (plan N10;
// ozet.js `isTasksAnswer`, `isPendingAnswer`, `isScopeAnswer`).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SUMMARY_POLL_MS, isPendingAnswer, isScopeAnswer, isTasksAnswer } from "./ozet.js";

export const LOADING = Object.freeze({ phase: "loading", data: null, atMs: null, error: null });
const hidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";
const isReport = (answer) => Number.isInteger(answer?.episodes);

/** `extra` (G4-04): `{may, read(api), valid, full?}` with stable functions (module constants) — one more read in the
 *  round, answered as `extra`; null (the summary page) reads nothing more, and `extra` stays LOADING. `full(answer)`:
 *  whether a valid answer is a whole one — «İş yükü»'s holds a /tasks read that can fail on its own, and a round in
 *  which it did is no full round («HH:MM itibarıyla» stays), as a failed /tasks holds it here. */
export function useSummaryReads({ store, rights, reloadStructure, everyMs = SUMMARY_POLL_MS, extra = null }) {
  const [tasks, setTasks] = useState(LOADING);
  const [pending, setPending] = useState(LOADING);
  const [scope, setScope] = useState(LOADING);
  const [more, setMore] = useState(LOADING);
  const [fullAt, setFullAt] = useState(null);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  const seq = useRef(0);

  const read = useCallback(async () => {
    seq.current += 1;
    const mine = seq.current;
    const current = () => alive.current && mine === seq.current;
    setBusy(true);
    // `whole`: whether an answer this page reads counts for the full round (`extra.full`; any other: yes).
    const one = async (may, call, valid, set, whole = null) => {
      if (!may) return true;
      try {
        const data = await store.track(call);
        if (!valid(data)) throw new Error("not the answer this page reads");
        if (current()) set({ phase: "ok", data, atMs: Date.now(), error: null });
        return whole ? whole(data) === true : true;
      } catch (error) {
        if (current()) set({ phase: "failed", data: null, atMs: null, error });
        return false;
      }
    };
    const answered = await Promise.all([
      rights.structure ? reloadStructure().then((tree) => tree !== null, () => false) : true,
      one(rights.tasks, () => store.api.tasks(), isTasksAnswer, setTasks),
      one(rights.pending, () => store.api.pendingHandovers(), isPendingAnswer, setPending),
      one(true, () => store.api.myScope(), isScopeAnswer, setScope),
      one(Boolean(extra?.may), () => extra.read(store.api), extra?.valid, setMore, extra?.full),
    ]);
    if (current()) {
      if (answered.every(Boolean)) setFullAt(Date.now());
      setBusy(false);
    }
  }, [store, rights.structure, rights.tasks, rights.pending, reloadStructure, extra?.may, extra?.read, extra?.valid,
    extra?.full]);

  useEffect(() => {
    alive.current = true;
    read();
    const timer = setInterval(() => { if (!hidden()) read(); }, everyMs);
    const wake = () => { if (!hidden()) read(); };
    document.addEventListener("visibilitychange", wake);
    return () => {
      alive.current = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [read, everyMs]);

  return { tasks, pending, scope, extra: more, fullAt, busy, refresh: read };
}

/** One read of a page for a period, `read(api, period)`: on open, on a period change and on `retry` (a user's action —
 *  «Yeniden dene», «Yenile»), never on a timer. The newest read wins; an answer `valid` refuses is a failed read (plan
 *  N10). `read` and `valid` must be module constants: a new function each render would read again each render.
 *  G4-03: «Kalite göstergeleri» reads `/quality` through it, as `useQuality` reads `/alarm-quality`.
 *  An answer or a failure is kept with the period it was read for: in the render right after a period change, before
 *  the new read starts, it is not this period's, so the hook says «loading» (G4-03 review). */
export function usePeriodRead({ store, may, period, read, valid }) {
  const [state, setState] = useState(LOADING);
  const [attempt, setAttempt] = useState(0);
  const seq = useRef(0);
  const retry = useCallback(() => { setAttempt((n) => n + 1); }, []);
  useEffect(() => {
    if (!may) return undefined;
    seq.current += 1;
    const mine = seq.current;
    let alive = true;
    setState(LOADING);
    store.track(() => read(store.api, period)).then(
      (data) => {
        if (!alive || mine !== seq.current) return;
        setState(valid(data) ? { phase: "ok", data, atMs: Date.now(), error: null, period }
          : { phase: "failed", data: null, atMs: null, error: null, period });
      },
      (error) => { if (alive && mine === seq.current) setState({ phase: "failed", data: null, atMs: null, error, period }); },
    );
    return () => { alive = false; };
  }, [store, may, period, attempt, read, valid]);
  return useMemo(() => ({ ...(state.phase === "loading" || state.period === period ? state : LOADING), retry }),
    [state, period, retry]);
}

const readAlarmQuality = (api, days) => api.alarmQuality(days);

export function useQuality({ store, may, period }) {
  return usePeriodRead({ store, may, period, read: readAlarmQuality, valid: isReport });
}

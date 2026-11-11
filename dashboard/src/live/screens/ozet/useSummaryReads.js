// src/live/screens/ozet/useSummaryReads.js — G4-02 «Yönetici özeti» (spec D5): the page's own reads.
//
// `useSummaryReads`: the tree (through the shell's StructureProvider — every screen keeps the one tree), `/tasks` and
// `/handovers/pending`, read when the page opens, on «Yenile», and every SUMMARY_POLL_MS while the page is visible (and
// at once when it is shown again). A read that fails keeps nothing of its last answer: the page says «okunamadı», never
// an older number as today's. `fullAt`: when the last round in which every source this session may read answered came
// back — the header's «HH:MM itibarıyla».
//
// `useQuality`: `/alarm-quality` for one period, read when the page opens and when the period changes — never on a
// timer (spec D5 §3: the API rebuilds every episode of the window from the audit trail) — and again on «Yeniden dene»
// (`retry`, a user's action after a failure). The newest read wins.
//
// An answer of the wrong shape — one malformed entry is enough — is a failed read, never a partial count (plan N10;
// ozet.js `isTasksAnswer`, `isPendingAnswer`).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SUMMARY_POLL_MS, isPendingAnswer, isTasksAnswer } from "./ozet.js";

export const LOADING = Object.freeze({ phase: "loading", data: null, atMs: null, error: null });
const hidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";
const isReport = (answer) => Number.isInteger(answer?.episodes);

export function useSummaryReads({ store, rights, reloadStructure, everyMs = SUMMARY_POLL_MS }) {
  const [tasks, setTasks] = useState(LOADING);
  const [pending, setPending] = useState(LOADING);
  const [fullAt, setFullAt] = useState(null);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  const seq = useRef(0);

  const read = useCallback(async () => {
    seq.current += 1;
    const mine = seq.current;
    const current = () => alive.current && mine === seq.current;
    setBusy(true);
    const one = async (may, call, valid, set) => {
      if (!may) return true;
      try {
        const data = await store.track(call);
        if (!valid(data)) throw new Error("not the answer this page reads");
        if (current()) set({ phase: "ok", data, atMs: Date.now(), error: null });
        return true;
      } catch (error) {
        if (current()) set({ phase: "failed", data: null, atMs: null, error });
        return false;
      }
    };
    const answered = await Promise.all([
      rights.structure ? reloadStructure().then((tree) => tree !== null, () => false) : true,
      one(rights.tasks, () => store.api.tasks(), isTasksAnswer, setTasks),
      one(rights.pending, () => store.api.pendingHandovers(), isPendingAnswer, setPending),
    ]);
    if (current()) {
      if (answered.every(Boolean)) setFullAt(Date.now());
      setBusy(false);
    }
  }, [store, rights.structure, rights.tasks, rights.pending, reloadStructure]);

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

  return { tasks, pending, fullAt, busy, refresh: read };
}

export function useQuality({ store, may, period }) {
  const [read, setRead] = useState(LOADING);
  const [attempt, setAttempt] = useState(0);
  const seq = useRef(0);
  const retry = useCallback(() => { setAttempt((n) => n + 1); }, []);
  useEffect(() => {
    if (!may) return undefined;
    seq.current += 1;
    const mine = seq.current;
    let alive = true;
    setRead(LOADING);
    store.track(() => store.api.alarmQuality(period)).then(
      (data) => {
        if (!alive || mine !== seq.current) return;
        setRead(isReport(data) ? { phase: "ok", data, atMs: Date.now(), error: null }
          : { phase: "failed", data: null, atMs: null, error: null });
      },
      (error) => { if (alive && mine === seq.current) setRead({ phase: "failed", data: null, atMs: null, error }); },
    );
    return () => { alive = false; };
  }, [store, may, period, attempt]);
  return useMemo(() => ({ ...read, retry }), [read, retry]);
}

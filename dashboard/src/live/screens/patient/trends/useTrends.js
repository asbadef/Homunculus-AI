// src/live/screens/patient/trends/useTrends.js — one patient's trends, read through the session
// (GET /patients/{id}/trends; homunculus-engine api/trends.py).
//
//   const { data, loading, unreadable, lastOkAt, reload } = useTrends(patientId, hours, measuredKey);
//
// Four rules, each held by useTrends.test.jsx:
//   * READ ONLY WHILE THE SESSION IS READY. A locked screen shows nothing of a patient, so nothing
//     is read for one; an answer that lands after the lock, a sign-out or another sign-in is dropped.
//     (The shell also unmounts at the lock, which clears the timers; this does not rely on it.)
//   * A FAILED READ KEEPS THE LAST ANSWER and says the trends are unreadable, with the time the last
//     answer came — the monitor strip's rule. A chart that went blank on one dropped request would
//     read as "no measurements", which is a claim about the patient, and a false one.
//   * NEVER ANOTHER PATIENT'S ANSWER. A move to another patient or window shows nothing until that
//     one answers, and a late answer for the one left behind is dropped.
//   * READ AGAIN when the board says something was measured (`measuredKey`), and once a minute while
//     the page is visible — an antibiotic charted elsewhere moves no `measuredAt`.
import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "../../../session/SessionProvider.jsx";
import { PHASE } from "../../../session/sessionStore.js";

export const TRENDS_POLL_MS = 60_000;

const NOTHING = Object.freeze({ data: null, loading: true, unreadable: false, lastOkAt: null });

/** A string that changes exactly when one of the patient card's measured instants does. */
export function measuredKeyOf(measuredAt) {
  return Object.entries(measuredAt ?? {})
    .filter(([, at]) => typeof at === "string" && at !== "")
    .map(([key, at]) => `${key}=${at}`)
    .sort()
    .join("|");
}

/** This patient's trends for this window — or not an answer at all. */
const isTrends = (answer, patientId, hours) => Boolean(answer) && typeof answer === "object"
  && answer.patient_id === patientId && answer.hours === hours && Array.isArray(answer.channels);

const hidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";

export function useTrends(patientId, hours, measuredKey = "") {
  const { phase, store } = useSession();
  const ready = phase === PHASE.READY;
  const key = `${patientId}|${hours}`;
  const [state, setState] = useState({ ...NOTHING, key });
  const seq = useRef(0);

  const read = useCallback(async () => {
    seq.current += 1;
    const mine = seq.current;
    const epoch = store.epoch();
    const stale = () => mine !== seq.current || epoch !== store.epoch();
    try {
      const answer = await store.track(() => store.api.patientTrends(patientId, hours));
      if (stale()) return;
      if (!isTrends(answer, patientId, hours)) throw new Error("not a trends answer");
      setState({ data: answer, loading: false, unreadable: false, lastOkAt: Date.now(), key });
    } catch (err) {
      if (err?.superseded || stale()) return;
      setState((s) => (s.key === key ? { ...s, loading: false, unreadable: true }
        : { ...NOTHING, loading: false, unreadable: true, key }));
    }
  }, [store, patientId, hours, key]);

  // Mount, a new patient or window, a new measurement: read. Leaving READY: whatever is in flight
  // will not land.
  useEffect(() => {
    if (!ready) {
      seq.current += 1;
      return;
    }
    read();
  }, [ready, read, measuredKey]);

  // Once a minute while visible, and at once when the page comes back.
  useEffect(() => {
    if (!ready) return undefined;
    let timer = 0;
    const tick = () => {
      if (!hidden()) read();
      timer = setTimeout(tick, TRENDS_POLL_MS);
    };
    const wake = () => {
      if (!hidden()) read();
    };
    timer = setTimeout(tick, TRENDS_POLL_MS);
    document.addEventListener("visibilitychange", wake);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [ready, read]);

  // Gone: nothing late may land.
  useEffect(() => () => { seq.current += 1; }, []);

  const shown = state.key === key ? state : { ...NOTHING, key };
  return { data: shown.data, loading: shown.loading, unreadable: shown.unreadable, lastOkAt: shown.lastOkAt, reload: read };
}

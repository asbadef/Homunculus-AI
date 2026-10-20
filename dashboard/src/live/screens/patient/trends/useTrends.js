// src/live/screens/patient/trends/useTrends.js — one patient's trends, read through the session
// (GET /patients/{id}/trends; homunculus-engine api/trends.py).
//
//   const { data, loading, unreadable, lastOkAt, reload } = useTrends(patientId, hours, measuredKey);
//
// Six rules, each held by useTrends.test.jsx:
//   * READ ONLY WHILE THE SESSION IS READY. A locked screen shows nothing of a patient, so nothing
//     is read for one — not by the timer, not by `reload()`; an answer that lands after the lock, a
//     sign-out or another sign-in is dropped. (The shell also unmounts at the lock, which clears the
//     timers; this does not rely on it.)
//   * A FAILED READ KEEPS THE LAST ANSWER and says the trends are unreadable, with the time the last
//     answer came — the monitor strip's rule. A chart that went blank on one dropped request would
//     read as "no measurements", which is a claim about the patient, and a false one.
//   * NEVER ANOTHER PATIENT'S ANSWER. A move to another patient or window shows nothing until that
//     one answers, and a late answer for the one left behind is dropped. That move — and leaving
//     READY, and unmounting — are the ONLY things that discard a read in flight.
//   * READS FOR THE SAME PATIENT AND WINDOW DO NOT SUPERSEDE EACH OTHER (the shadow store's
//     `inFlight` guard). A new measurement, the timer, a return to the page or `reload()` that
//     arrives while a read is in flight sets one `queued` flag; when that read settles, success or
//     failure, ONE more is made. Measurements arriving faster than the endpoint answers (a burst
//     from one HL7 message, a 72 h window) therefore still fill the box, and a `reload()` after a
//     save still yields data read after the save.
//   * READ AGAIN when the board says something was measured (`measuredKey`), and once a minute while
//     the page is visible — an antibiotic charted elsewhere moves no `measuredAt`.
//   * A HIDDEN PAGE READS NOTHING. The minute timer is not armed while the page is hidden (no
//     no-op ticks), a new measurement does not read, and the return to visible reads once and
//     starts the minute again — the shadow store's cadence.
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

/** This patient's trends for this window — or not an answer at all. The window is compared as a
 *  number: a `hours` that reached us as "24" must not turn every answer into an unreadable one. */
const isTrends = (answer, patientId, hours) => Boolean(answer) && typeof answer === "object"
  && answer.patient_id === patientId && Number(answer.hours) === Number(hours) && Array.isArray(answer.channels);

// Either says hidden, it is hidden (the shadow store's rule).
const hidden = () => typeof document !== "undefined"
  && (document.visibilityState === "hidden" || document.hidden === true);

export function useTrends(patientId, hours, measuredKey = "") {
  const { phase, store } = useSession();
  const ready = phase === PHASE.READY;
  const key = `${patientId}|${hours}`;
  const [state, setState] = useState({ ...NOTHING, key });
  const generation = useRef(0);   // bumped when a read in flight may no longer land
  const inFlight = useRef(false);
  const queued = useRef(false);   // a read was asked for while one was in flight: one more, after it
  const readFor = useRef(null);   // the key the last pass read for; null while not READY

  /** Ask for a read of this patient and window — the one way every trigger gets one. */
  const request = useCallback(() => {
    if (store.getState().phase !== PHASE.READY) return;
    if (inFlight.current) {
      queued.current = true;
      return;
    }
    inFlight.current = true;
    queued.current = false;
    const mine = generation.current;
    const epoch = store.epoch();
    const stale = () => mine !== generation.current || epoch !== store.epoch()
      || store.getState().phase !== PHASE.READY;
    (async () => {
      let again = true;
      try {
        const answer = await store.track(() => store.api.patientTrends(patientId, hours));
        if (stale()) return;
        if (!isTrends(answer, patientId, hours)) throw new Error("not a trends answer");
        setState({ data: answer, loading: false, unreadable: false, lastOkAt: Date.now(), key });
      } catch (err) {
        if (err?.superseded) {
          again = false;
          return;
        }
        if (stale()) return;
        setState((s) => (s.key === key ? { ...s, loading: false, unreadable: true }
          : { ...NOTHING, loading: false, unreadable: true, key }));
      } finally {
        // Only the read that still counts frees the slot; one that was discarded left it to whoever
        // discarded it. A page that was hidden meanwhile reads when it comes back, not now.
        if (mine === generation.current) {
          inFlight.current = false;
          const next = again && queued.current && epoch === store.epoch() && !hidden();
          queued.current = false;
          if (next) request();
        }
      }
    })();
  }, [store, patientId, hours, key]);

  // Mount, a new patient or window, READY again: whatever is in flight is discarded and the read
  // starts afresh. Leaving READY: whatever is in flight will not land. The same patient and window
  // with a new measurement: a request (which joins the one in flight), unless the page is hidden.
  useEffect(() => {
    if (!ready) {
      generation.current += 1;
      inFlight.current = false;
      queued.current = false;
      readFor.current = null;
      return;
    }
    if (readFor.current !== key) {
      readFor.current = key;
      generation.current += 1;
      inFlight.current = false;
      queued.current = false;
      request();
    } else if (!hidden()) {
      request();
    }
  }, [ready, key, measuredKey, request]);

  // Once a minute while the page is visible. Hidden: no timer at all. Back: one read now, and the
  // minute starts from then.
  useEffect(() => {
    if (!ready) return undefined;
    let timer = 0;
    const stop = () => {
      clearTimeout(timer);
      timer = 0;
    };
    const arm = () => {
      stop();
      if (!hidden()) timer = setTimeout(tick, TRENDS_POLL_MS);
    };
    const tick = () => {
      timer = 0;
      request();
      arm();
    };
    const onVisibility = () => {
      if (hidden()) {
        stop();
        return;
      }
      request();
      arm();
    };
    arm();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [ready, request]);

  // Gone: nothing late may land.
  useEffect(() => () => {
    generation.current += 1;
    inFlight.current = false;
    queued.current = false;
    readFor.current = null;
  }, []);

  const shown = state.key === key ? state : { ...NOTHING, key };
  return { data: shown.data, loading: shown.loading, unreadable: shown.unreadable, lastOkAt: shown.lastOkAt, reload: request };
}

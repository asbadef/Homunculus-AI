// src/live/screens/patient/readings/useReadings.js — one patient's measurement record, read through the session
// (GET /patients/{id}/readings; homunculus-engine api/readings.py), on mount, once a minute, when the window
// changes and on `refresh()` — the box calls that after a correction (G3-05 D16). useFluids.js's pattern.
//
//   const { data, error, refresh } = useReadings(patientId, hours);
//
// A FAILED READ KEEPS THE LAST ANSWER and reports the error: a record that went blank on one dropped request would
// read as «nothing measured», a claim about the patient and a false one. NEVER ANOTHER PATIENT'S ANSWER, NOR ANOTHER
// WINDOW'S: a move to another patient or window shows nothing until that one answers, and an answer that is not
// this patient's record for this window is not shown. A sequence number drops an answer overtaken by a later read.
import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "../../../session/SessionProvider.jsx";

export const READINGS_POLL_MS = 60_000;
/** The windows the engine accepts (api/readings.py READINGS_HOURS), in hours: 24 h, 72 h, 7 days. */
export const READINGS_WINDOWS = Object.freeze([24, 72, 168]);

/** This patient's record for this window — or not an answer at all. */
const isReadings = (answer, patientId, hours) => Boolean(answer) && typeof answer === "object"
  && answer.patient_id === patientId && answer.hours === hours && Array.isArray(answer.sets);

const NOTHING = Object.freeze({ data: null, error: null });

export function useReadings(patientId, hours = 24, { everyMs = READINGS_POLL_MS } = {}) {
  const { store } = useSession();
  const key = `${patientId}|${hours}`;
  const [state, setState] = useState({ forKey: key, ...NOTHING });
  const alive = useRef(true);
  const seq = useRef(0);
  const shownKey = useRef(key);
  const read = useCallback(async () => {
    if (shownKey.current !== key) return;        // a patient or window left behind: its refresh lands nowhere
    const mine = ++seq.current;
    const current = () => alive.current && mine === seq.current;
    try {
      const answer = await store.track(() => store.api.patientReadings(patientId, hours));
      if (!current()) return;
      if (!isReadings(answer, patientId, hours)) throw new Error("not a measurement record");
      setState({ forKey: key, data: answer, error: null });
    } catch (error) {
      if (error?.superseded || !current()) return;
      setState((s) => (s.forKey === key ? { ...s, error } : { forKey: key, data: null, error }));
    }
  }, [store, patientId, hours, key]);
  useEffect(() => {
    shownKey.current = key;
    alive.current = true;
    read();
    const timer = setInterval(read, everyMs);
    return () => {
      alive.current = false;
      seq.current += 1;          // a read in flight for what was left behind lands nowhere
      clearInterval(timer);
    };
  }, [read, everyMs, key]);
  const shown = state.forKey === key ? state : NOTHING;
  return { data: shown.data, error: shown.error, refresh: read };
}

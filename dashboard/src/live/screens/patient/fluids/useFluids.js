// src/live/screens/patient/fluids/useFluids.js — one patient's fluid ledger, read through the session
// (GET /patients/{id}/fluids; homunculus-engine api/fluids.py), on mount, once a minute and on `refresh()` — the
// box calls that after its own writes and withdrawals (spec D12).
//
//   const { data, error, refresh } = useFluids(patientId);
//
// A FAILED READ KEEPS THE LAST ANSWER and reports the error: a ledger that went blank on one dropped request would
// read as «nothing charted», a claim about the patient and a false one. NEVER ANOTHER PATIENT'S ANSWER: a move to
// another patient shows nothing until that one answers, and an answer that is not this patient's ledger is not
// shown. A sequence number drops an answer overtaken by a later read (a slow tick behind the read after a write).
import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "../../../session/SessionProvider.jsx";

export const FLUIDS_POLL_MS = 60_000;

/** This patient's ledger — or not an answer at all. */
const isFluids = (answer, patientId) => Boolean(answer) && typeof answer === "object"
  && answer.patient_id === patientId && Boolean(answer.totals) && typeof answer.totals === "object"
  && Array.isArray(answer.hours) && Array.isArray(answer.entries);

const NOTHING = Object.freeze({ data: null, error: null });

export function useFluids(patientId, { everyMs = FLUIDS_POLL_MS } = {}) {
  const { store } = useSession();
  const [state, setState] = useState({ forId: patientId, ...NOTHING });
  const alive = useRef(true);
  const seq = useRef(0);
  const read = useCallback(async () => {
    const mine = ++seq.current;
    const current = () => alive.current && mine === seq.current;
    try {
      const answer = await store.track(() => store.api.patientFluids(patientId));
      if (!current()) return;
      if (!isFluids(answer, patientId)) throw new Error("not a fluid ledger");
      setState({ forId: patientId, data: answer, error: null });
    } catch (error) {
      if (error?.superseded || !current()) return;
      setState((s) => (s.forId === patientId ? { ...s, error } : { forId: patientId, data: null, error }));
    }
  }, [store, patientId]);
  useEffect(() => {
    alive.current = true;
    read();
    const timer = setInterval(read, everyMs);
    return () => {
      alive.current = false;
      seq.current += 1;          // a read in flight for the patient left behind lands nowhere
      clearInterval(timer);
    };
  }, [read, everyMs]);
  const shown = state.forId === patientId ? state : NOTHING;
  return { data: shown.data, error: shown.error, refresh: read };
}

// src/live/screens/enfeksiyon/useInfection.js — «Enfeksiyon kontrol» (G4-05, spec D14 as §5 M9 and S1 amend it): the
// page's own read, GET /infection, on mount and every 30 s — Eczane's tempo (usePharmacy.js), whose running antibiotic
// clocks and alarm states this page shows too. Its own small hook with usePharmacy's rules, not a shared one (§5 M9):
//   - nothing is read from a hidden tab; the tab shown again reads at once;
//   - the sequence guard: the answer to an earlier read never lands over a newer one;
//   - a 401 or a 403 drops the held answer (the right was withdrawn, the session is gone); a 5xx, a timeout or a
//     network failure keeps it, and the page says it is not current;
//   - an answer of another shape — `counts` not an object; `isolated`, `suspected`, `bed_occupants` or `units` not
//     arrays — is a failed read (`error.malformed`), never an empty ward;
//   - the clock skew of each answer, taken as it lands (common/skewAtReceipt.js, usePharmacy's own rule).
// And one thing usePharmacy does not do (§5 S1): with each read it asks the shell's structure tree to be read again
// (`reloadStructure`: StructureProvider's `reload`, as useSummaryReads does), so the isolation beds the page draws from
// the tree are as fresh as the list. The page passes it only to a session that may read the tree (STRUCTURE_PERMS); it
// reads the tree's state itself (ozet.js `structureSource`). A tree that fails to read never holds the list back.
import { useCallback, useEffect, useRef, useState } from "react";
import { PHARMACY_TICK_MS } from "../eczane/usePharmacy.js";
import { skewAtReceipt } from "../common/skewAtReceipt.js";

/** Eczane's 30 s (spec D14): the same clocks, read at the same tempo. */
export const INFECTION_TICK_MS = PHARMACY_TICK_MS;

const hidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";
const malformed = () => Object.assign(new Error(""), { malformed: true });
/** The caller is no longer allowed to see the list (as `apiErrors.js` reads a refusal: by its status). */
const refused = (error) => error?.status === 401 || error?.status === 403;
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/** GET /infection as this page reads it (§5 M9); anything else is a failed read. */
export function isInfectionAnswer(answer) {
  return isObject(answer) && isObject(answer.counts) && Array.isArray(answer.isolated)
    && Array.isArray(answer.suspected) && Array.isArray(answer.bed_occupants) && Array.isArray(answer.units);
}

export function useInfection(store, { reloadStructure = null, everyMs = INFECTION_TICK_MS } = {}) {
  const [state, setState] = useState({ data: null, error: null, skewMs: null });
  const alive = useRef(true);
  //: the sequence of the latest read issued; an answer to an earlier one is dropped
  const seq = useRef(0);
  const read = useCallback(async () => {
    const mine = ++seq.current;
    if (reloadStructure) Promise.resolve(reloadStructure()).catch(() => {});
    try {
      const data = await store.track(() => store.api.infection());
      if (!isInfectionAnswer(data)) throw malformed();
      const skewMs = skewAtReceipt(store.api, data);
      if (alive.current && mine === seq.current) setState({ data, error: null, skewMs });
    } catch (error) {
      if (alive.current && mine === seq.current) {
        setState((s) => ({ data: refused(error) ? null : s.data, error, skewMs: s.skewMs }));
      }
    }
  }, [store, reloadStructure]);
  useEffect(() => {
    alive.current = true;
    read();
    const wake = () => { if (!hidden()) read(); };
    const id = setInterval(wake, everyMs);
    document.addEventListener("visibilitychange", wake);
    return () => {
      alive.current = false;
      clearInterval(id);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [read, everyMs]);
  return { data: state.data, error: state.error, skewMs: state.skewMs, refresh: read };
}

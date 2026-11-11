// src/live/screens/eczane/usePharmacy.js — reads GET /pharmacy on mount and every 30 s (G3-04, spec D17), in the
// shape of gorevler/useTasks.js. A failed read keeps the last answer and reports the error: the screen then says
// the list is not fresh, and never calls it empty (spec D18, §6). An answer without a `rows` array is a failed
// read (`error.malformed`), never an empty ward. The tab shown again reads at once: a list read before the tab was
// hidden is not fresh, and the pharmacist should not wait a whole tick for today's.
//
// A HIDDEN TAB ASKS FOR NOTHING: the 30 s tick is skipped while the tab is hidden; the read on `visibilitychange`
// brings the list back the moment it is shown.
//
// A REFUSED READ DROPS THE LIST. A network failure, a timeout or a 5xx says nothing about the caller, so the last
// answer stays (under «güncel değil»). A 401 or a 403 says the caller may no longer see the list — the right was
// withdrawn, the session is gone — so the held answer is dropped and the page shows only the read's error.
//
// THE PAGE'S OWN CLOCK SKEW (`skewMs`, server minus browser, ms; null while unknown). The board store, whose skew
// `useBoardNow` reads, only starts for a `board.view` holder, and this page opens with `pharmacy.view` alone. So
// each answer's skew is taken here, the moment it lands: the one the API client measured from the answer's `Date`
// header (`serverClockSkewMs`, backendApi), else — a proxy stripped the header — the answer's own `now` against
// this browser's clock. The screen corrects its clock with it when the board has no skew (pharmacyModel
// `clockSkewOf`), so a workstation whose clock is wrong neither reads a dead list as fresh nor a live one as stale.
import { useCallback, useEffect, useRef, useState } from "react";
import { msOf } from "./pharmacyModel.js";

export const PHARMACY_TICK_MS = 30_000;

const hidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";
const malformed = () => Object.assign(new Error(""), { malformed: true });
/** The caller is no longer allowed to see the list (as `apiErrors.js` reads a refusal: by its status). */
const refused = (error) => error?.status === 401 || error?.status === 403;

/** backendApi's own floor for a measured skew: under it the honest answer is 0. */
const SKEW_NOISE_MS = 2_000;

/** Server minus browser, in ms, at the moment `answer` landed; null when neither the client nor the answer says.
 *  The answer's own `now` is read the way the client reads the `Date` header (backendApi `noteServerDate`): the
 *  route stamped it before the answer travelled, so a right clock measures minus the latency — under the noise
 *  floor that is 0, and above it the figure is rounded to the second. Injected raw, the jitter would move the
 *  instant every duration is counted against on every answer, and a minute would flicker at its boundary. */
function skewAtReceipt(api, answer) {
  const measured = typeof api?.serverClockSkewMs === "function" ? api.serverClockSkewMs() : null;
  if (Number.isFinite(measured)) return measured;
  const at = msOf(answer.now);
  if (at === null) return null;
  const raw = at - Date.now();
  return Math.abs(raw) < SKEW_NOISE_MS ? 0 : Math.round(raw / 1000) * 1000;
}

export function usePharmacy(store, { everyMs = PHARMACY_TICK_MS } = {}) {
  const [state, setState] = useState({ data: null, error: null, skewMs: null });
  const alive = useRef(true);
  //: the sequence of the latest read issued; an answer to an earlier one is dropped, so the screen never shows
  //: an older list over a newer one (useTasks)
  const seq = useRef(0);
  const read = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const data = await store.track(() => store.api.pharmacy());
      if (!data || !Array.isArray(data.rows)) throw malformed();
      const skewMs = skewAtReceipt(store.api, data);
      if (alive.current && mine === seq.current) setState({ data, error: null, skewMs });
    } catch (error) {
      if (alive.current && mine === seq.current) {
        setState((s) => ({ data: refused(error) ? null : s.data, error, skewMs: s.skewMs }));
      }
    }
  }, [store]);
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

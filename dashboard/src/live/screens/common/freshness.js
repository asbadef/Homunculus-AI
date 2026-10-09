// src/live/screens/common/freshness.js — how old a card's readings are. Pure.
//
// THE RULE THIS FILE EXISTS FOR: the screen reports the AGE of a value and never decides whether
// that age is too old. "Too old" is a clinical threshold — the engine owns every one of those, and
// a browser that picked its own would be scoring the patient (Wave 0's lesson: NEWS2 was being
// computed here and had to be torn out). So: `ageOf` gives a number, `lastMeasuredAt` gives an
// instant, and nothing here returns "stale". Where the engine has judged freshness it says so
// itself, per alarm (`staleInputs`, reco/engine.py `Alert.stale_inputs`), and the screen shows that
// judgement as the engine's.
//
// `hasMeasurement` is the other half of an honesty rule that lives in `ui/riskStyle.js`: risk
// "none" may read "no finding" ONLY on a card that has observations behind it; on a card admitted
// but never measured it must read "not measured". riskStyle refuses to assume it, so the card has
// to pass `measured` — and this is where that answer comes from, out of the card's own timestamps.

/** Every signal `latest.at` carries, in the order a vital bar shows them (api/board.py
 *  `_PUBLISHED_SIGNALS`; `liveAdapters.patientFromBoard` keeps `measuredAt` as the server sent it,
 *  so these are the server's own keys, not the adapter's short vital names). */
export const SIGNAL_KEYS = Object.freeze([
  "heart_rate", "resp_rate", "spo2", "sbp", "map", "temperature", "lactate",
]);

/** The instants in a card's `measuredAt` block, as epoch milliseconds, newest first. */
function instants(measuredAt) {
  const at = measuredAt && typeof measuredAt === "object" ? measuredAt : {};
  return Object.values(at)
    .map((iso) => (iso ? Date.parse(iso) : NaN))
    .filter((ms) => !Number.isNaN(ms))
    .sort((a, b) => b - a);
}

/** Whether ANY channel of this card has ever been measured. This is what `measured` means to
 *  `riskStyle`: with it, risk "none" reads "no finding"; without it, "not measured". */
export function hasMeasurement(measuredAt) {
  return instants(measuredAt).length > 0;
}

/** When this card was last measured on any channel (epoch ms), or null if never. */
export function lastMeasuredAt(measuredAt) {
  return instants(measuredAt)[0] ?? null;
}

/** How old one channel's value is, in milliseconds, or null when it was never measured or the
 *  instant cannot be read. Negative (a server ahead of this browser) is reported as 0: the value
 *  is as new as this screen can tell, and a negative age would read as the future. */
export function ageOf(iso, nowMs = Date.now()) {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return Math.max(0, nowMs - ms);
}

/** How many of these cards have never been measured at all — a patient the hospital admitted whose
 *  monitor has sent nothing here. A FACT, not a threshold: no window is chosen, so nothing in this
 *  count depends on a judgement the browser is not entitled to make. */
export function neverMeasured(patients) {
  const list = Array.isArray(patients) ? patients : [];
  return list.filter((p) => !hasMeasurement(p?.measuredAt)).length;
}

/** The oldest "last measured" instant among the cards that HAVE been measured (epoch ms), or null
 *  when none has. With `neverMeasured` this is the whole feed-health statement a browser may make:
 *  how many cards have nothing, and how long ago the quietest of the rest last spoke. Whether that
 *  is too long is the reader's judgement — the screen does not rank it. */
export function oldestMeasurement(patients) {
  const list = Array.isArray(patients) ? patients : [];
  const times = list.map((p) => lastMeasuredAt(p?.measuredAt)).filter((ms) => ms !== null);
  return times.length ? Math.min(...times) : null;
}

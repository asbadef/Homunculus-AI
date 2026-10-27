// src/live/screens/patient/shadow/shadowVitals.js — how a shadow input is NAMED, wherever it is printed:
// the «Gölge öneri» box's inputs and the patient screen's shadow vital cards (Aşama B, D7).
//
// A shadow input is the monitor's UNVALIDATED number as the shadow engine read it:
// `{value, unit, at, source, via}` under a channel code (api/infinity_rules.py `findings`). Its name and
// its unit are written BY CHANNEL CODE with the `board.*` words the rest of the screen uses — the wire's
// own unit string ("bpm") is never shown, so a heart rate does not read «/dk» on one card and «bpm» on
// the next — and its source by the monitor's own label (HR, PLS, SpO₂, ART, NBP).
//
// A code or a source this build does not know is NOT guessed at: the lookups below answer `undefined`
// for it and the caller prints the string as the engine sent it (never «HR» for an unknown source).
export const CODE_LABEL = { heart_rate: "board.chHr", spo2: "board.chSpo2", sbp: "board.chSbp", map: "board.chMap" };
export const CODE_UNIT = { heart_rate: "board.unitBpm", spo2: "board.unitPct", sbp: "board.unitMmhg", map: "board.unitMmhg" };
export const VIA_KEY = { hr: "shadow.viaHr", pls: "shadow.viaPls", spo2: "shadow.viaSpo2", art: "shadow.viaArt", nbp: "shadow.viaNbp" };

/** An own property of a table, or undefined — never an inherited one («constructor», «toString»). */
export const own = (table, key) => (typeof key === "string" && Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined);

/** The stamp of the newest input the shadow engine read (`vitals[*].at`, as the engine wrote it), or null
 *  when it read none with a stamp that parses. A held shadow score is aged by it — the API republishes a
 *  patient only when a sample is taken or a link ends, so with a silent forwarder the same number would
 *  otherwise stand undated for as long as nobody looks (the «Gölge öneri» box, the bed card's tag). The
 *  stamps are compared, not computed with: the age itself is ageText's, against the screen's clock. */
export function newestInputAt(shadow) {
  let newest = null;
  let newestMs = Number.NEGATIVE_INFINITY;
  for (const input of Object.values(shadow?.vitals ?? {})) {
    const at = input?.at;
    const ms = typeof at === "string" ? Date.parse(at) : Number.NaN;
    if (Number.isFinite(ms) && ms > newestMs) {
      newest = at;
      newestMs = ms;
    }
  }
  return newest;
}

// src/live/screens/eczane/pharmacyModel.js — «Eczane» (G3-04): what the page's cells say, from one row of the server's
// answer. Pure: no React, no translator, no clock of its own.
//
// THE SERVER DECIDES (spec D4; G2-A3 Decision 1). Each row's `antibiotic.state`, the order of the rows, the four
// counters and the fluid totals are the engine's (`api/pharmacy.py`). Nothing here recomputes, re-sorts or judges
// them: this module picks the text KEY for the state the server sent and hands back the instants and numbers the
// screen formats. The two things the screen does compute are the two the server cannot send — an age, and the time
// left to or passed since `deadline` — from the server's ISO stamps against the page's skew-corrected clock
// (`clockSkewOf`), and only while the answer is fresh (spec D17, §5.1).
//
// A LIST THAT IS NOT FRESH NEVER READS AS TODAY'S (spec D18, §6). `isFresh` is the one rule; with `fresh` false the
// `running` and `missed` cells stop counting and read in the past tense with the one stamp that stays true (the
// deadline), and a vasopressor's age becomes its charted time.
//
// TONES MIRROR THE ENGINE'S SEVERITIES AND NOTHING ELSE (spec D14): `missed` is `crit` and `running` is `high`, the
// severities `rules/antibiotic_clock.py` gives `antibiotic_overdue` and `antibiotic_due`. Every other state,
// creatinine and the fluid balance carry no tone at all. Nothing is green.
import { PRESSORS } from "../patient/meds/medsFields.js";

/** §6: three polls. An answer whose `now` is further behind the screen's clock than this is not fresh. */
export const PHARMACY_FRESH_MS = 90_000;
/** The whole text keys of the two sentences the Meds box prints a vasopressor with (D6, D20). */
const RUNNING = "patient.medsRunning";
const STOPPED = "patient.medsStopped";
const TONES = Object.freeze({ missed: "crit", running: "high" });
const DRUG_KEYS = new Map(PRESSORS.map((p) => [p.key, p.labelKey]));

/** An ISO stamp as epoch milliseconds, or null for one that is missing or does not parse. */
export function msOf(iso) {
  const ms = typeof iso === "string" ? Date.parse(iso) : Number.NaN;
  return Number.isFinite(ms) ? ms : null;
}

/** §6: fresh = the last read succeeded and the answer's `now` is at most PHARMACY_FRESH_MS behind the screen's
 *  clock (a hidden tab shown again is not fresh until its poll lands). No answer, or a clock that is no number, is
 *  not fresh. */
export function isFresh(answer, error, nowMs) {
  if (!answer || error) return false;
  const at = msOf(answer.now);
  return at !== null && typeof nowMs === "number" && Number.isFinite(nowMs) && nowMs - at <= PHARMACY_FRESH_MS;
}

/** The skew the page's clock is corrected by (server minus browser, ms). The board's whenever the board store has
 *  measured one — a `board.view` holder's clock is `useBoardNow`'s, unchanged. The board store only starts for a
 *  `board.view` holder, so for a session that holds `pharmacy.view` alone it is the skew of this page's own answers
 *  (`usePharmacy`'s `skewMs`). 0 when neither is known: no answer has landed yet, and nothing is aged before one. */
export function clockSkewOf(boardSkewMs, ownSkewMs) {
  if (Number.isFinite(boardSkewMs)) return boardSkewMs;
  return Number.isFinite(ownSkewMs) ? ownSkewMs : 0;
}

/** §5.1: a duration as its text key and parameters. `n = floor(seconds / 60)`, as the engine's alarm text counts
 *  (`int(seconds // 60)`): 0 is «<1 dk», under 120 «{n} dk», from 120 on «{h} sa {m} dk». A negative duration is 0;
 *  one that is no number has no text (null). */
export function durationParts(seconds) {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return null;
  const n = Math.floor(Math.max(0, seconds) / 60);
  if (n === 0) return { key: "eczane.dur.under", params: {} };
  if (n < 120) return { key: "eczane.dur.min", params: { n } };
  return { key: "eczane.dur.hm", params: { h: Math.floor(n / 60), m: n % 60 } };
}

/** The antibiotic cell of one row (spec §3.1, D7, D8, D14, §6): `{ state, key, tone, duration, timeMs, second }`.
 *  - `state` is the server's word, untouched; `key` the text for it; `tone` "crit" | "high" | null.
 *  - `duration` ({key, params} | null) fills `{duration}`: the time to the deadline (`running`) or since it
 *    (`missed`), from the server's `deadline` against `nowMs` — the server's own `remaining_sec` when that cannot
 *    be computed. The STATE WORD never follows the screen's clock: a `running` row whose deadline passes between
 *    two polls reads «<1 dk kaldı» until the next answer says `missed`.
 *  - `timeMs` (number | null) fills `{time}`: the administration's charted time (`met`, `late`, `given`), or the
 *    deadline in the two past-tense twins of a list that is not fresh.
 *  - `second` ({key, timeMs} | null), under `running` and `missed`, fresh or not: «tanınma {saat} · uygulama kaydı
 *    yok» when nothing was charted (`given` null). With `given` strictly false something WAS charted — a 0, or a
 *    dose stamped before recognition, which the engine's rule does not count — so «no record» would be untrue and
 *    the line says what is missing: «tanınma {saat} · tanınmadan sonra sayılan uygulama kaydı yok». The state
 *    word, the tone and the duration do not follow `given`, and neither line says the drug was not given (D8).
 *  A state this build does not know is printed as the server's own word (`eczane.ab.unknown`), never as «Kayıt yok». */
export function antibioticCell(row, nowMs, fresh) {
  const ab = row?.antibiotic ?? {};
  const state = ab.state ?? null;
  const plain = (key, timeMs = null) => ({ state, key, tone: null, duration: null, timeMs, second: null });
  if (state === "running" || state === "missed") {
    const deadline = msOf(ab.deadline);
    const second = { key: ab.given === false ? "eczane.ab.noCountedAdmin" : "eczane.ab.noAdmin", timeMs: msOf(ab.recognized_at) };
    if (!fresh) {
      return { state, key: state === "running" ? "eczane.ab.staleRunning" : "eczane.ab.staleMissed",
        tone: TONES[state], duration: null, timeMs: deadline, second };
    }
    const sign = state === "running" ? 1 : -1;
    const seconds = deadline !== null && typeof nowMs === "number" && Number.isFinite(nowMs)
      ? (sign * (deadline - nowMs)) / 1000
      : (typeof ab.remaining_sec === "number" ? sign * ab.remaining_sec : Number.NaN);
    return { state, key: `eczane.ab.${state}`, tone: TONES[state], duration: durationParts(seconds), timeMs: null, second };
  }
  if (state === "met" || state === "late" || state === "given") return plain(`eczane.ab.${state}`, msOf(ab.given_at));
  if (state === "none") return plain("eczane.noRecord");
  return plain("eczane.ab.unknown");
}

/** The vasopressor lines of one row (spec D6), in the server's order: `{ drug, drugKey, key, rate, at, atMs, aged }`.
 *  `key` is the Meds box's own sentence — running for a rate above 0, stopped for a 0. `drugKey` is the drug's name
 *  in the dictionary, or null for a drug this build does not know (the screen then prints the server's word).
 *  `aged`: print the charted time as an age (`ageText(t, at, nowMs)`) — only while the answer is fresh and the
 *  stamp reads; otherwise the charted time itself (`dayStamp(atMs)`), or a dash for a rate that came without one. */
export function pressorLines(row, nowMs, fresh) {
  const list = Array.isArray(row?.pressors) ? row.pressors : [];
  return list.filter((p) => typeof p?.rate === "number" && Number.isFinite(p.rate)).map((p) => {
    const atMs = msOf(p.at);
    return {
      drug: String(p.drug ?? ""), drugKey: DRUG_KEYS.get(p.drug) ?? null, key: p.rate > 0 ? RUNNING : STOPPED,
      rate: p.rate, at: p.at ?? null, atMs,
      aged: Boolean(fresh) && atMs !== null && typeof nowMs === "number" && Number.isFinite(nowMs),
    };
  });
}

/** Creatinine as the row carries it (spec D12): `{ value, atMs }`, or null when none was ever observed. A number
 *  and its time — no tone, no threshold, no trend. */
export function creatinineCell(row) {
  const c = row?.creatinine;
  if (!c || typeof c.value !== "number" || !Number.isFinite(c.value)) return null;
  return { value: c.value, atMs: msOf(c.at) };
}

/** Today's fluid balance as the row carries it (spec D13): `{ balance, intake, output, entries, lastMs }`, or null
 *  for a patient with no entry in the fluid day — «Bugün kayıt yok», never «0 mL». The numbers are the server's
 *  sums; no tone, no target. */
export function fluidCell(row) {
  const f = row?.fluid;
  if (!f || typeof f !== "object") return null;
  return { balance: f.balance_ml, intake: f.in_ml, output: f.out_ml, entries: f.entries, lastMs: msOf(f.last_at) };
}

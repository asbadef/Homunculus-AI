// src/live/screens/bedside/vitalsFields.js — the bedside form's eight inputs and its rules (G3-01, D2, D4, D6, D7,
// X9, X12). Pure: no React and no request.
//
// THE INPUTS in the prototype's order (tasarim-taslaklari/app/nursing.js `bedside`): solunum, SpO₂, ek oksijen,
// sistolik, MAP, nabız, bilinç, ateş. Each has the engine's code and the board's own label and unit keys (one name
// for a channel across the product). A number has the door's slip bounds (api/clinical.py PLAUSIBLE), mirrored only
// to hold a slipped digit back; the server stays authoritative. No band and no point lives here: the browser scores
// nothing (Decision 1).
//
// THE RULES: an empty box is «ölçülmedi» and is not sent (D4), and at least one value is asked for. MAP sits below
// the systolic within one form (D6). A typed time goes up to 24 h back and never ahead; an untouched one is not sent
// at all, and the server stamps its own clock (X12). The number rule is the Meds form's, imported: one "plain
// decimal" (a comma read as a point) for every chart the patient screen writes.
import { BACKDATE_MS, fromLocalInput, number, toLocalInput } from "../patient/meds/medsFields.js";

export { BACKDATE_MS, toLocalInput } from "../patient/meds/medsFields.js";

/** A minute of skew between this browser's clock and the server's: not "ahead" on the future side (the Meds
 *  form's minute), and the margin kept inside the 24 h edge on the past side, so the browser is the stricter one. */
export const SKEW_MS = 60_000;

/** The oldest instant `checkDraft` takes: a day back plus the skew, never the day itself. */
const oldestMs = (now) => now - BACKDATE_MS + SKEW_MS;

/** The time box's native `min`: the first whole minute `checkDraft` takes, so the picker offers nothing the check
 *  then refuses. The box holds whole minutes, and a clock that is not on a minute puts the edge between two of them:
 *  the minute below it is refused, so this rounds up. */
export const oldestInput = (now) => toLocalInput(Math.ceil(oldestMs(now) / 60_000) * 60_000);

export const VITALS = Object.freeze([
  Object.freeze({ code: "resp_rate", kind: "number", labelKey: "board.chRr", unitKey: "board.unitBpm",
    min: 0, max: 80, whole: true, step: 1 }),
  Object.freeze({ code: "spo2", kind: "number", labelKey: "board.chSpo2", unitKey: "board.unitPct",
    min: 0, max: 100, whole: true, step: 1 }),
  Object.freeze({ code: "supplemental_oxygen", kind: "choice", labelKey: "olcum.o2",
    options: Object.freeze([{ value: "0", labelKey: "olcum.o2Air" }, { value: "1", labelKey: "olcum.o2On" }]) }),
  Object.freeze({ code: "sbp", kind: "number", labelKey: "board.chSbp", unitKey: "board.unitMmhg",
    min: 0, max: 300, whole: true, step: 1 }),
  Object.freeze({ code: "map", kind: "number", labelKey: "board.chMap", unitKey: "board.unitMmhg",
    min: 0, max: 300, whole: true, step: 1, hintKey: "olcum.mapHint" }),
  Object.freeze({ code: "heart_rate", kind: "number", labelKey: "board.chHr", unitKey: "board.unitBpm",
    min: 0, max: 300, whole: true, step: 1 }),
  // ACVPU as the engine records it (canonical.py): 0 = Alert … 4 = Unresponsive. The keys are written out, never
  // built: a key made at run time is out of the raw-key sweep's reach (rawKeys.test.jsx).
  Object.freeze({ code: "acvpu", kind: "choice", labelKey: "olcum.acvpu",
    options: Object.freeze([{ value: "0", labelKey: "olcum.acvpuA" }, { value: "1", labelKey: "olcum.acvpuC" },
      { value: "2", labelKey: "olcum.acvpuV" }, { value: "3", labelKey: "olcum.acvpuP" },
      { value: "4", labelKey: "olcum.acvpuU" }]) }),
  Object.freeze({ code: "temperature", kind: "number", labelKey: "board.chTemp", unitKey: "board.unitC",
    min: 25, max: 45, whole: false, step: 0.1 }),
]);

const SPECS = Object.freeze(Object.fromEntries(VITALS.map((s) => [s.code, s])));

/** The input for an engine code, or null — own properties only ("constructor" is not an input). */
export const specOf = (code) => (Object.prototype.hasOwnProperty.call(SPECS, code) ? SPECS[code] : null);

/** One box: `{ skip: true }` when empty (D4), `{ value }`, or `{ error: { key, params? } }`. */
export function checkVital(spec, raw) {
  const text = String(raw ?? "").trim();
  if (spec.kind === "choice") {
    if (text === "") return { skip: true };
    return spec.options.some((o) => o.value === text) ? { value: Number(text) } : { error: { key: "olcum.notNumber" } };
  }
  const n = number(text);
  if (n === "") return { skip: true };
  if (Number.isNaN(n)) return { error: { key: "olcum.notNumber" } };
  if (spec.whole && !Number.isInteger(n)) return { error: { key: "olcum.notWhole" } };
  // One decimal BY VALUE: "36,50" is 36.5 and is taken; "36,85" is a second digit that matters. (`number` has
  // already refused a second separator, so `text` holds at most one.)
  const frac = text.split(/[.,]/)[1] ?? "";
  if (!spec.whole && frac.replace(/0+$/, "").length > 1) return { error: { key: "olcum.oneDecimal" } };
  if (n < spec.min || n > spec.max) {
    return { error: { key: "olcum.outOfRange", params: { low: spec.min, high: spec.max } } };
  }
  return { value: n };
}

/** The whole draft: `{ entries, recordedAt, errors }`. `draft` is `{ values: {code: raw}, at, atTouched }`, `at`
 *  the `datetime-local` value in the browser's zone; `now` the browser's clock in ms. `errors` is by code, plus
 *  `form` (nothing entered) and `at`. `recordedAt` is a UTC instant, or null for an untouched time (X12). With no
 *  `now` it reads the browser's own clock: a missing clock must not switch the time bounds off. */
export function checkDraft({ values = {}, at = "", atTouched = false } = {}, now = Date.now()) {
  const errors = {};
  const entries = [];
  for (const spec of VITALS) {
    const checked = checkVital(spec, values[spec.code]);
    if (checked.error) errors[spec.code] = checked.error;
    else if (!checked.skip) entries.push({ code: spec.code, value: checked.value });
  }
  const sbp = entries.find((e) => e.code === "sbp");
  const map = entries.find((e) => e.code === "map");
  if (sbp && map && map.value >= sbp.value && !errors.map) errors.map = { key: "olcum.mapAboveSbp" };
  if (entries.length === 0 && Object.keys(errors).length === 0) errors.form = { key: "olcum.nothing" };
  let recordedAt = null;
  if (atTouched) {
    const ms = fromLocalInput(at);
    if (!Number.isFinite(ms)) errors.at = { key: "olcum.atInvalid" };
    else if (ms > now + SKEW_MS) errors.at = { key: "olcum.atFuture" };
    // A minute INSIDE the day: the server refuses a time older than 24 h by its own clock, and a form that sent
    // the edge itself could be a second too old on arrival. This side is the stricter one.
    else if (ms < oldestMs(now)) errors.at = { key: "olcum.atTooOld" };
    else recordedAt = new Date(ms).toISOString();
  }
  return { entries, recordedAt, errors };
}

export const hasErrors = (checked) => Object.keys(checked.errors).length > 0;

/** What a draft would send, as one string: a preview is of THIS key, and a changed box makes it old. */
export const draftKey = (checked) => JSON.stringify([checked.entries, checked.recordedAt]);

/** The value one step up (`direction` 1) or down (-1), inside the bounds, as the box shows it; null from an empty
 *  or unreadable box — a stepper never invents a first value — and from a choice, which has no number to move.
 *  A whole vital typed with a fraction ("26,5") steps to the next whole number in the direction pressed, never
 *  past it. */
export function stepValue(spec, raw, direction) {
  if (spec.kind !== "number") return null;
  const n = number(String(raw ?? "").trim());
  if (n === "" || Number.isNaN(n)) return null;
  const moved = spec.whole ? (direction > 0 ? Math.floor(n) + 1 : Math.ceil(n) - 1) : n + direction * spec.step;
  const next = Math.min(spec.max, Math.max(spec.min, moved));
  return spec.whole ? String(Math.round(next)) : (Math.round(next * 10) / 10).toFixed(1);
}

/** A sent value as the clinician reads it: the option's words for a choice, the number and its unit otherwise. */
export function valueText(t, code, value) {
  const spec = specOf(code);
  if (!spec) return String(value);
  if (spec.kind === "choice") {
    const option = spec.options.find((o) => Number(o.value) === value);
    return option ? t(option.labelKey) : String(value);
  }
  return `${value} ${t(spec.unitKey)}`;
}

/** NEWS2's seven parameters in the score's order (rules/news2.py), with the label the preview names each
 *  by. `missingKey` is NEWS2's own word for a missing one (news2.missing.*), written out, never built: only
 *  the five measured vitals can be missing; oxygen and consciousness are scored as air and Alert when
 *  nothing current is charted, which the engine calls `assumed`, not missing. */
export const NEWS2_PARAMETERS = Object.freeze([
  Object.freeze({ name: "respiration_rate", labelKey: "board.chRr", missingKey: "news2.missing.respiration_rate" }),
  Object.freeze({ name: "spo2", labelKey: "board.chSpo2", missingKey: "news2.missing.spo2" }),
  Object.freeze({ name: "air_or_oxygen", labelKey: "olcum.o2", missingKey: null }),
  Object.freeze({ name: "systolic_bp", labelKey: "board.chSbp", missingKey: "news2.missing.systolic_bp" }),
  Object.freeze({ name: "pulse", labelKey: "board.chHr", missingKey: "news2.missing.pulse" }),
  Object.freeze({ name: "consciousness", labelKey: "olcum.acvpu", missingKey: null }),
  Object.freeze({ name: "temperature", labelKey: "board.chTemp", missingKey: "news2.missing.temperature" }),
]);

/** The year of an ISO birth date, or null (X9: the board carries `birth_date`, never a year it made up). */
export function birthYearOf(iso) {
  const match = /^(\d{4})-\d{2}-\d{2}/.exec(String(iso ?? ""));
  return match ? match[1] : null;
}

/** The latest NEWS2 input's measurement instant (ms) on a card, whatever its source, or null. The board does not
 *  carry provenance, so the page's list says "son ölçüm" — of any source (X13). */
export function lastMeasuredMs(patient) {
  const at = patient?.news2?.measured_at;
  if (!at || typeof at !== "object") return null;
  const stamps = Object.values(at).map((v) => (typeof v === "string" ? Date.parse(v) : Number.NaN)).filter(Number.isFinite);
  return stamps.length ? Math.max(...stamps) : null;
}

// src/live/screens/kalite/kalite.js — G4-03 «Kalite göstergeleri» (spec 2026-11-11 D5), pure: `GET /quality`'s answer
// as the page draws it. KaliteScreen.jsx only words it.
//
// ONE READ, ONE SOURCE. The page reads `/quality` for a period (`usePeriodRead` with `readQuality` and
// `isQualityAnswer`) and turns the read into a source by the summary page's own rule (ozet.js `readSource`): an answer
// it may count from, or «—» and why — loading, failed, no right — never a 0 in its place (Decision 18). An answer of
// the wrong shape (one malformed figure is enough) is a failed read, never a partial table.
//
// THE ROWS are the answer's units in its order (by name), then «Birimi belli olmayan» (an unrestricted caller's only),
// then «Toplam» (the answer's `hospital`: the whole hospital, or a scoped caller's units' sum). Every active unit in the
// caller's reach is in the answer, a quiet one with its zeros; so a scoped answer with no unit at all is an empty
// reach (`noReach`), never a quiet week (G4-03 review). A row is selected by its key; the snooze reasons and the
// alarms by kind are drawn for the selection.
//
// No patient anywhere: the answer carries unit ids and names, counts, times and the engine's alert kinds.
import { normId } from "../../data/structure.js";
import { SNOOZE_REASONS } from "../../data/snooze.js";
import { WHY, durationOf, wholePercent } from "../ozet/ozet.js";

/** The «Toplam» row's key and the «Birimi belli olmayan» row's; a unit's own key is its id (normId). */
export const TOTAL = "total";
export const UNPLACED = "unplaced";
/** The periods the engine answers (`GET /quality?days`). */
const DAYS = Object.freeze([1, 7, 30]);
/** The snooze reason codes' words: the alarm screen's own (`ertele.reason.*`, SnoozeDialog's REASON_KEYS). */
export const REASON_KEYS = Object.freeze({
  CLINICAL_DECISION_MADE: "ertele.reason.clinical",
  ARTEFACT_OR_SIGNAL_NOISE: "ertele.reason.artefact",
  PROCEDURE_IN_PROGRESS: "ertele.reason.procedure",
  PATIENT_BASELINE: "ertele.reason.baseline",
  OTHER: "ertele.reason.other",
});

/** How the page reads its answer (`usePeriodRead`'s `read`): a module constant, so a render does not read again. */
export const readQuality = (api, days) => api.qualityIndicators(days);

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isCount = (value) => Number.isInteger(value) && value >= 0;
const isSeconds = (value) => value === null || (Number.isFinite(value) && value >= 0);
const isRate = (value) => value === null || (Number.isFinite(value) && value >= 0 && value <= 1);
const counts = (object, keys) => keys.every((key) => isCount(object[key]));

function msOf(iso) {
  const ms = typeof iso === "string" ? Date.parse(iso) : NaN;
  return Number.isFinite(ms) ? ms : null;
}

function isAlarms(a) {
  return isObject(a) && counts(a, ["episodes", "answered", "escalated", "unanswered", "unanswered_resolved", "pending"])
    && a.unanswered_resolved <= a.unanswered && isRate(a.answered_rate) && isSeconds(a.median_response_sec) && isSeconds(a.p90_response_sec)
    && Array.isArray(a.per_kind) && a.per_kind.every((k) => isObject(k) && typeof k.kind === "string"
      && counts(k, ["episodes", "answered", "escalated", "unanswered"]) && isSeconds(k.median_response_sec));
}

const isSnoozes = (s) => isObject(s) && isCount(s.count) && isObject(s.by_reason) && counts(s.by_reason, SNOOZE_REASONS)
  && isObject(s.by_severity) && counts(s.by_severity, ["high", "moderate"]) && isSeconds(s.median_minutes);

const isHandovers = (h) => isObject(h) && counts(h, ["opened", "countersigned", "waiting", "expired"])
  && isSeconds(h.median_countersign_sec) && isSeconds(h.p90_countersign_sec);

const isBlock = (b, withHandovers) => isObject(b) && isAlarms(b.alarms) && isSnoozes(b.snoozes) && isObject(b.rrt)
  && isCount(b.rrt.count) && (!withHandovers || isHandovers(b.handovers));

/** `GET /quality`'s answer as this page reads it (spec D4). Anything else is a failed read. A scoped caller is never
 *  sent the unplaced row, and the self-resolved are some of the unanswered (G4-03 review). */
export function isQualityAnswer(answer) {
  return isObject(answer) && DAYS.includes(answer.days) && msOf(answer.generated_at) !== null
    && msOf(answer.window_from) !== null && typeof answer.truncated === "boolean" && typeof answer.scoped === "boolean"
    && isObject(answer.coverage) && counts(answer.coverage, ["episodes", "placed", "unplaced"])
    && Array.isArray(answer.units) && answer.units.every((u) => isBlock(u, true) && typeof u.unit_id === "string"
      && u.unit_id.trim() !== "" && typeof u.unit_name === "string")
    && (answer.unplaced === null || (!answer.scoped && isBlock(answer.unplaced, false)))
    && isBlock(answer.hospital, true);
}

/** One row's alarm figures: counts as sent; the rate as a whole percent, null when nothing settled — 100 only when
 *  every settled one was answered, 0 only when none was (ozet.js `wholePercent`); times as minutes and seconds
 *  (ozet.js `durationOf`), null over nothing. */
export function alarmsView(a) {
  const settled = a.answered + a.unanswered;
  return {
    episodes: a.episodes, answered: a.answered, settled, pct: wholePercent(a.answered_rate, a.answered, settled),
    median: durationOf(a.median_response_sec), p90: durationOf(a.p90_response_sec), escalated: a.escalated,
    unanswered: a.unanswered, selfResolved: a.unanswered_resolved, pending: a.pending,
    perKind: a.per_kind.map((k) => ({ kind: k.kind, episodes: k.episodes, answered: k.answered, escalated: k.escalated,
      unanswered: k.unanswered, median: durationOf(k.median_response_sec) })),
  };
}

/** One row's snoozes: the reasons in the alarm screen's order, the two severities, the median minutes. */
export function snoozesView(s) {
  return { count: s.count, byReason: SNOOZE_REASONS.map((reason) => ({ reason, n: s.by_reason[reason] })),
    high: s.by_severity.high, moderate: s.by_severity.moderate, medianMinutes: s.median_minutes };
}

/** One row's handovers; null for the unplaced row (every handover has a unit). */
export function handoversView(h) {
  return h ? { opened: h.opened, countersigned: h.countersigned, waiting: h.waiting, expired: h.expired,
    median: durationOf(h.median_countersign_sec), p90: durationOf(h.p90_countersign_sec) } : null;
}

const rowOf = (key, name, block) => ({ key, name, alarms: alarmsView(block.alarms), snoozes: snoozesView(block.snoozes),
  rrt: block.rrt.count, handovers: handoversView(block.handovers) });

/** The page from its one source, for the period on the switch: `{ok: false, why}` while there is no answer to count
 *  from, and a failed read for another period's answer (G4-03 review); else the rows, the unplaced row (null for a
 *  scoped caller), the total row (the cards' figures), the coverage, and the read's flags — `noReach`: a scoped
 *  caller reaches no unit at all. */
export function qualityPage(source, period) {
  if (!source.ok) return { ok: false, why: source.why };
  const answer = source.data;
  if (answer.days !== period) return { ok: false, why: WHY.failed };
  return {
    ok: true, scoped: answer.scoped, noReach: answer.scoped && answer.units.length === 0, truncated: answer.truncated,
    windowFromMs: msOf(answer.window_from), generatedAtMs: msOf(answer.generated_at),
    coverage: { episodes: answer.coverage.episodes, placed: answer.coverage.placed, unplaced: answer.coverage.unplaced },
    rows: answer.units.map((unit) => rowOf(normId(unit.unit_id), unit.unit_name, unit)),
    unplaced: answer.unplaced ? rowOf(UNPLACED, null, answer.unplaced) : null,
    total: rowOf(TOTAL, null, answer.hospital),
  };
}

/** The row a selection names — a unit's, the unplaced row or the total; the total for a key the newest answer no
 *  longer holds (another period, «Yenile»). Null with no answer. */
export function selectionOf(page, key) {
  if (!page.ok) return null;
  if (key === UNPLACED && page.unplaced) return page.unplaced;
  return page.rows.find((row) => row.key === key) ?? page.total;
}

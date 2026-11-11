// src/live/screens/ozet/ozet.js — G4-02 «Yönetici özeti» (spec 2026-11-11 D5), pure: what each source the page reads
// says once Decision 18 is applied, and the per-unit join. OzetScreen.jsx only words it.
//
// A SOURCE is what the page holds of one read: `{ok: true, data, atMs}` — an answer it may count from — or
// `{ok: false, why}` — none, and why (WHY): still loading, failed, not fresh (the live board not LIVE, the shadow board
// past its display limit), no right to it, the monitor chain broken, its state unknown, the strip off. A number comes
// only from an `ok` source; every other gives «—» and its reason, never 0 (Decision 18: only a fresh answer says «none»).
//
// The join is by the structure's unit ids (normId): the live board's alarms by their card's `unitId`, `/tasks` by the
// card's unit (the engine's D4 fix), `/handovers/pending` by its own, the shadow board by the card's `unit_id`. What no
// unit of the tree claims — a card on no bed, an unassigned monitor, a unit the tree does not hold — is the «Birimi
// belli olmayan» row (NO_UNIT), drawn only when it has something to count.
//
// THE CALLER'S REACH. Every source but the tree is cut to the caller's reach by the server; the tree is cut too, except
// for `structure.manage` (the whole hospital), and a unit reached through a bed grant alone is listed with that bed
// only. So a unit outside her unit grants is no answer about that unit: its cells say «yetki yok», its beds too unless
// the tree is whole — never a 0. The reach is GET /scope/me (`reachSource`: any signed-in user may ask it, and it is
// built as the board's scope is), one of the page's own reads; until it answers, the cells it decides say why. The
// alarm column alone keeps the live board's own `scope` (`boardReachSource`): its counts and their cut are one answer,
// and without `board.view` it is «yetki yok» from its own source, not the others. The cards then count only what she
// was sent, and say so (`reachNote`).
//
// No patient here and no clinical threshold: counts, times and the engine's own severities.
import { normId } from "../../data/structure.js";
import { STRUCTURE_PERMS } from "../../data/StructureProvider.jsx";
import { waitingAlarms } from "../../data/boardStore.js";
import { SHADOW_PHASE, mayReadShadow } from "../../data/shadowStore.js";
import { CONNECTION } from "../../../liveConnection.js";
import { readUnknown, stripOn } from "../common/MonitorStrip.jsx";
import { maxAgeOf } from "../common/monitor.js";
import { listingOf, measuredAtMs, silentRows, verdictOf } from "../devices/deviceFeed.js";
import { windowStart } from "../denetim/heat.js";
import { unitCounts } from "../doluluk/occupancy.js";

/** How often the page reads `/tasks`, `/tenant/structure` and `/handovers/pending` while it is visible (spec D5). */
export const SUMMARY_POLL_MS = 60_000;
/** The alarm-quality periods in days (`/alarm-quality?days`), and the one the page opens on: the API's default. */
export const PERIODS = Object.freeze([1, 7, 30]);
export const DEFAULT_PERIOD = 7;
/** The «Birimi belli olmayan» row's key: what a missing unit id reads as (normId). A unit's own key is its UUID. */
export const NO_UNIT = "";
/** Why a source gives no number; each has its words (`ozet.why.*`). `stale` is the live board's (not LIVE),
 *  `stripStale` the shadow board's (past its display limit, or its last poll failed). */
export const WHY = Object.freeze({
  loading: "loading", failed: "failed", stale: "stale", noRight: "noRight", chain: "chain", unknown: "unknown",
  stripOff: "stripOff", stripStale: "stripStale",
});

export const okSource = (data, atMs = null) => ({ ok: true, data, atMs });
export const noSource = (why) => ({ ok: false, why });

const MINUTE_MS = 60_000;
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const listOf = (value) => (Array.isArray(value) ? value : []);
const countOf = (value) => (Number.isInteger(value) && value >= 0 ? value : null);
const secondsOf = (value) => (Number.isFinite(value) && value >= 0 ? value : null);
const minMs = (a, b) => (a === null ? b : b === null ? a : Math.min(a, b));

function msOf(iso) {
  const ms = typeof iso === "string" ? Date.parse(iso) : NaN;
  return Number.isFinite(ms) ? ms : null;
}

/** Which sources these rights may read, by the API's own rules: the tree, the live board, the task queue, the
 *  waiting handovers (this page's own key), the shadow board, and the audit trail alarm quality is read from.
 *  `wholeTree`: the tree is the whole hospital's whatever the scope (`GET /tenant/structure` for `structure.manage`). */
export function rightsOf(perms) {
  const has = (key) => Array.isArray(perms) && perms.includes(key);
  return {
    structure: STRUCTURE_PERMS.some(has), board: has("board.view"), tasks: has("tasks.view"),
    pending: has("summary.view"), shadow: mayReadShadow(perms), quality: has("audit.view"),
    wholeTree: has("structure.manage"),
  };
}

/** `/tasks` as this page reads it: a list of patients, each with its unit (text or none), its vital task (an object
 *  with a state, or none) and a list of hand tasks that each say whether they are late. Anything else is a failed
 *  read (plan N10): skipping one malformed entry would show its unit a 0. */
export function isTasksAnswer(answer) {
  return Array.isArray(answer?.patients) && answer.patients.every((p) => isObject(p)
    && (p.unit_id == null || typeof p.unit_id === "string")
    && (p.vital == null || (isObject(p.vital) && typeof p.vital.state === "string"))
    && Array.isArray(p.tasks) && p.tasks.every((task) => isObject(task) && typeof task.late === "boolean"));
}

/** `/handovers/pending` as this page reads it: the server's time, and units each with an id, a whole count and the
 *  oldest signature's time (or none). Anything else is a failed read (plan N10). */
export function isPendingAnswer(answer) {
  return isObject(answer) && msOf(answer.generated_at) !== null && Array.isArray(answer.units)
    && answer.units.every((u) => isObject(u) && typeof u.unit_id === "string" && u.unit_id.trim() !== ""
      && Number.isInteger(u.pending) && u.pending >= 0
      && (u.oldest_outgoing_signed_at == null || msOf(u.oldest_outgoing_signed_at) !== null));
}

/** One of the page's own reads (`/tasks`, `/handovers/pending`, `/alarm-quality`) — `{phase: "loading" | "ok" |
 *  "failed", data, atMs, error}` — as a source. A refusal (403: a scoped caller, a right lost) is «yetki yok». */
export function readSource(read, mayRead) {
  if (!mayRead) return noSource(WHY.noRight);
  if (read?.phase === "ok") return okSource(read.data, read.atMs ?? null);
  if (read?.phase === "failed") return noSource(read.error?.status === 403 ? WHY.noRight : WHY.failed);
  return noSource(WHY.loading);
}

/** The tree (StructureProvider: `useStructure()`) as a source: only a read that just succeeded («known») counts. A
 *  refused read (403) is «yetki yok», another failure «okunamadı». */
export function structureSource({ phase, structure, error }, mayRead) {
  if (!mayRead || phase === "unasked") return noSource(WHY.noRight);
  if (phase === "known") return okSource(structure);
  if (phase === "stale" || phase === "failed") return noSource(error?.status === 403 ? WHY.noRight : WHY.failed);
  return noSource(WHY.loading);
}

/** The alarms somebody must answer (`waitingAlarms`' items), counted by the unit of their patient's card: the total,
 *  and the critical and high among them. */
export function waitingByUnit(patients, items) {
  const unitOf = new Map(listOf(patients).map((p) => [p.patient_id, normId(p.unitId)]));
  const out = new Map();
  for (const alarm of listOf(items)) {
    const key = unitOf.get(alarm.patientId) ?? NO_UNIT;
    const row = out.get(key) ?? { total: 0, critical: 0, high: 0 };
    row.total += 1;
    if (alarm.severity === "critical") row.critical += 1;
    if (alarm.severity === "high") row.high += 1;
    out.set(key, row);
  }
  return out;
}

/** The live board (`useBoard()`, the snooze clock's `nowMs`) as a source. Decision 18: only a LIVE board counts; a
 *  DEGRADED one is not fresh, one still connecting is loading, an unavailable one failed. */
export function boardSource({ connection, patients, alerts, nowMs }, mayRead) {
  if (!mayRead) return noSource(WHY.noRight);
  const { known, stale, items } = waitingAlarms({ alerts, connection, nowMs });
  if (known) return okSource({ byUnit: waitingByUnit(patients, items) });
  if (stale) return noSource(WHY.stale);
  return noSource(connection === CONNECTION.UNAVAILABLE ? WHY.failed : WHY.loading);
}

/** A scope (`{unrestricted, unit_ids, …}`: GET /scope/me, or the board's own block) as a reach: `{all: true}` when
 *  unrestricted, else its unit grants (normId); null for one that is neither. Only a unit grant reaches a unit: a bed
 *  grant names one bed, not the unit around it. */
function reachOfScope(scope) {
  if (scope?.unrestricted === true) return { all: true, units: null };
  if (scope?.unrestricted === false && Array.isArray(scope.unit_ids)) {
    const units = scope.unit_ids.filter((id) => typeof id === "string").map(normId).filter((id) => id !== NO_UNIT);
    return { all: false, units: new Set(units) };
  }
  return null;
}

/** GET /scope/me as this page reads it: whether the scope is unrestricted, and its unit grants as text. Anything
 *  else is a failed read (plan N10). */
export function isScopeAnswer(answer) {
  return isObject(answer) && typeof answer.unrestricted === "boolean" && Array.isArray(answer.unit_ids)
    && answer.unit_ids.every((id) => typeof id === "string");
}

/** The caller's reach, from GET /scope/me read as a source (`readSource`): the reach, or the read's own reason while
 *  it has not answered or failed (and «okunamadı» for an answer that is not a scope). */
export function reachSource(scopeRead) {
  if (!scopeRead.ok) return noSource(scopeRead.why);
  const reach = reachOfScope(scopeRead.data);
  return reach ? okSource(reach) : noSource(WHY.failed);
}

/** The alarm column's reach: the live board's own `scope` (GET /patients), so its counts and their cut come from one
 *  answer. A scope kept from the last load holds while the board is not LIVE; a board this session may not read is
 *  «yetki yok»; one that has not brought a scope gives its own reason, or «bilinmiyor» for an answer without one. */
export function boardReachSource(scope, board) {
  if (!board.ok && board.why === WHY.noRight) return noSource(WHY.noRight);
  const reach = reachOfScope(scope);
  if (reach) return okSource(reach);
  return noSource(board.ok ? WHY.unknown : board.why);
}

/** The silent rows (deviceFeed `silentRows`) by the unit of their card; an unassigned monitor has none. */
export function silentByUnit(data, rows) {
  const unitOf = new Map(listOf(data?.beds).filter((card) => typeof card?.source === "string")
    .map((card) => [card.source, normId(card.unit_id)]));
  const out = new Map();
  for (const row of listOf(rows)) {
    const key = unitOf.get(row.source) ?? NO_UNIT;
    out.set(key, (out.get(key) ?? 0) + 1);
  }
  return out;
}

/** The longest silence among the rows, in whole minutes — null when no row's last packet is known. */
export function longestMinutes(rows) {
  return listOf(rows).reduce((most, row) => (Number.isInteger(row?.minutes) && (most === null || row.minutes > most)
    ? row.minutes : most), null);
}

/** The shadow board (`useShadow()`) as a source, by the device page's own rules (G4-01): fresh only while the last poll
 *  answered within the display limit; a broken chain or an unknown state lists no monitor as silent; a view with no
 *  monitor has none silent. */
export function shadowSource({ phase, data, fetchedAtMs, nowMs }, mayRead) {
  if (!mayRead) return noSource(WHY.noRight);
  if (!data) return noSource(phase === SHADOW_PHASE.UNREADABLE ? WHY.failed : WHY.loading);
  if (!stripOn(data)) return noSource(WHY.stripOff);
  const fresh = phase === SHADOW_PHASE.OK && !readUnknown({ phase, fetchedAtMs }, nowMs, maxAgeOf(data));
  if (!fresh) return noSource(WHY.stripStale);
  const now = measuredAtMs(data, true, nowMs, fetchedAtMs);
  const listing = listingOf(data, verdictOf(data, now), now);
  if (listing === "chain") return noSource(WHY.chain);
  if (listing !== "rows" && listing !== "noLedger" && listing !== "noMonitors") return noSource(WHY.unknown);
  const rows = listing === "noMonitors" ? [] : silentRows(data, now);
  return okSource({ rows, byUnit: silentByUnit(data, rows), noMonitors: listing === "noMonitors" }, fetchedAtMs);
}

/** One patient's overdue work over the shift `/tasks` answers: the hand tasks the server marks `late`, and the vital
 *  measurement in state `late`. */
export function lateOf(patient) {
  const vital = patient?.vital?.state === "late" ? 1 : 0;
  return vital + listOf(patient?.tasks).filter((task) => task?.late === true).length;
}

/** `/tasks` counted by the card's unit. */
export function lateByUnit(answer) {
  const out = new Map();
  for (const patient of listOf(answer?.patients)) {
    const n = lateOf(patient);
    if (n > 0) out.set(normId(patient.unit_id), (out.get(normId(patient.unit_id)) ?? 0) + n);
  }
  return out;
}

/** `/handovers/pending` by unit: how many wait, and when the oldest was signed. */
export function pendingByUnit(answer) {
  const out = new Map();
  for (const unit of listOf(answer?.units)) {
    const n = countOf(unit?.pending);
    if (!n) continue;
    const key = normId(unit.unit_id);
    const row = out.get(key) ?? { pending: 0, oldestMs: null };
    out.set(key, { pending: row.pending + n, oldestMs: minMs(row.oldestMs, msOf(unit.oldest_outgoing_signed_at)) });
  }
  return out;
}

/** How long ago `fromMs` was at `toMs`: whole minutes under an hour, whole hours under a day, else whole days —
 *  floored, so «2 gün» is a true lower bound. Null when either instant is unknown. */
export function ageOf(fromMs, toMs) {
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return null;
  const minutes = Math.floor(Math.max(0, toMs - fromMs) / MINUTE_MS);
  if (minutes < 60) return { unit: "min", n: minutes };
  if (minutes < 24 * 60) return { unit: "hour", n: Math.floor(minutes / 60) };
  return { unit: "day", n: Math.floor(minutes / (24 * 60)) };
}

/** The tree's units, in its order (sites, then units): the key, the name, whether it is closed, and its beds'
 *  counts (Doluluk's `unitCounts`). */
export function unitsOf(tree) {
  const out = [];
  for (const site of listOf(tree?.sites)) {
    for (const unit of listOf(site?.units)) {
      if (unit?.id == null) continue;
      out.push({ key: normId(unit.id), name: unit.name ?? "", closed: unit.is_active === false, counts: unitCounts(unit) });
    }
  }
  return out;
}

const sumOf = (map, pick) => [...map.values()].reduce((sum, value) => sum + pick(value), 0);

/** The cards and the units table. `tree`: the last tree held (rows are read from it even when its latest read failed:
 *  `occupancy`, the tree's own source, then says why); null when none was ever read — `rows` is then null and the page
 *  says why it cannot draw them. `reach`: the caller's reach (`reachSource`, GET /scope/me); `boardReach`: the alarm
 *  column's (`boardReachSource`, the board's own scope); `wholeTree`: the tree is the whole hospital's
 *  (`rightsOf().wholeTree`). The others are sources (okSource / noSource).
 *
 *  A unit outside the reach says «yetki yok» in every counted cell, and in its occupancy unless the tree is whole;
 *  while the reach is not known, the cells it decides (overdue work, waiting handovers, silent monitors, and the beds
 *  unless the tree is whole) give the scope read's reason. The «Birimi belli olmayan» row is drawn only for a known
 *  unrestricted reach. `reachNote`: "scoped" — the cards count only what this caller was sent, not the hospital (a
 *  known, restricted reach); "unknown" — the scope read failed, so nobody can say; null — the hospital's, or the scope
 *  is still being read (nothing is claimed either way). Card 1's `truncated`: the report's own flag — its count is
 *  then incomplete. */
export function summarise({ tree, occupancy, board, tasks, pending, shadow, quality, reach = noSource(WHY.unknown),
  boardReach = reach, wholeTree = false }) {
  const late = tasks.ok ? lateByUnit(tasks.data) : null;
  const waits = pending.ok ? pendingByUnit(pending.data) : null;
  const generatedMs = pending.ok ? msOf(pending.data?.generated_at) : null;
  const unanswered = quality.ok ? countOf(quality.data?.unanswered) : null;
  let reachNote = null;
  if (reach.ok && !reach.data.all) reachNote = "scoped";
  else if (!reach.ok && reach.why !== WHY.loading) reachNote = "unknown";
  const cards = {
    unanswered: !quality.ok ? { why: quality.why } : unanswered === null ? { why: WHY.unknown }
      : { value: unanswered, truncated: quality.data?.truncated === true },
    pending: waits ? { value: sumOf(waits, (row) => row.pending),
      age: ageOf([...waits.values()].reduce((at, row) => minMs(at, row.oldestMs), null), generatedMs) } : { why: pending.why },
    late: late ? { value: sumOf(late, (n) => n) } : { why: tasks.why },
    silent: shadow.ok ? { value: shadow.data.rows.length, longest: longestMinutes(shadow.data.rows),
      noMonitors: shadow.data.noMonitors } : { why: shadow.why },
  };
  if (!tree) return { cards, rows: null, unplaced: null, reachNote };

  const units = unitsOf(tree);
  const known = new Set(units.map((unit) => unit.key));
  // A source's map re-keyed by the tree: an id the tree does not hold joins the NO_UNIT row.
  const regroup = (map, merge) => {
    const out = new Map();
    for (const [key, value] of map ?? []) {
      const at = known.has(key) ? key : NO_UNIT;
      out.set(at, out.has(at) ? merge(out.get(at), value) : value);
    }
    return out;
  };
  const waiting = regroup(board.ok ? board.data.byUnit : null,
    (a, b) => ({ total: a.total + b.total, critical: a.critical + b.critical, high: a.high + b.high }));
  const lateBy = regroup(late, (a, b) => a + b);
  const pendingBy = regroup(waits, (a, b) => ({ pending: a.pending + b.pending, oldestMs: minMs(a.oldestMs, b.oldestMs) }));
  const silentBy = regroup(shadow.ok ? shadow.data.byUnit : null, (a, b) => a + b);
  const cellsOf = (key) => ({
    waiting: board.ok ? { value: waiting.get(key)?.total ?? 0, critical: waiting.get(key)?.critical ?? 0,
      high: waiting.get(key)?.high ?? 0 } : { why: board.why },
    late: tasks.ok ? { value: lateBy.get(key) ?? 0 } : { why: tasks.why },
    pending: pending.ok ? { value: pendingBy.get(key)?.pending ?? 0,
      age: ageOf(pendingBy.get(key)?.oldestMs ?? null, generatedMs) } : { why: pending.why },
    silent: shadow.ok ? { value: silentBy.get(key) ?? 0 } : { why: shadow.why },
  });
  // A unit outside the reach is no answer about that unit (Decision 18); an unknown reach is no answer about any.
  const outOf = (which, key) => which.ok && !which.data.all && !which.data.units.has(key);
  const gate = (which, key, cell) => {
    if (outOf(which, key)) return { why: WHY.noRight };
    if ("why" in cell) return cell;
    return which.ok ? cell : { why: which.why };
  };
  const occupancyOf = (unit) => {
    if (!wholeTree && outOf(reach, unit.key)) return { why: WHY.noRight };   // the tree lists only her granted beds there
    if (!occupancy.ok) return { why: occupancy.why };
    return wholeTree || reach.ok ? { ...unit.counts } : { why: reach.why };
  };
  const gated = (key) => {
    const cells = cellsOf(key);
    return {
      waiting: gate(boardReach, key, cells.waiting), late: gate(reach, key, cells.late),
      pending: gate(reach, key, cells.pending), silent: gate(reach, key, cells.silent),
    };
  };
  const rows = units.map((unit) => ({
    key: unit.key, name: unit.name, closed: unit.closed, occupancy: occupancyOf(unit), ...gated(unit.key),
  }));
  const rest = gated(NO_UNIT);
  const any = reach.ok && reach.data.all && Object.values(rest).some((cell) => (cell.value ?? 0) > 0);
  return { cards, rows, unplaced: any ? { key: NO_UNIT, occupancy: null, ...rest } : null, reachNote };
}

/** A response time in seconds as whole minutes and seconds (`m` null under a minute); null for none. */
export function durationOf(seconds) {
  const s = secondsOf(seconds);
  if (s === null) return null;
  const whole = Math.round(s);
  return whole < 60 ? { m: null, s: whole } : { m: Math.floor(whole / 60), s: whole % 60 };
}

/** «2026-11-09» -> «09.11»: a day of `per_day` (a UTC calendar day, as the engine counts it). */
export const dayOf = (date) => `${date.slice(8, 10)}.${date.slice(5, 7)}`;

/** `/alarm-quality`'s answer as the box draws it: each figure, or null when the answer does not carry it — never a 0
 *  in its place. `answeredRate` is null when nothing has settled (the engine's own null). Each day's bar is its share
 *  of the busiest day; the patient-level fields of the answer (`noisiest_beds`, `per_patient_hour`) are not read. */
export function qualityView(report) {
  const days = listOf(report?.per_day).filter((d) => typeof d?.date === "string" && countOf(d?.episodes) !== null);
  const busiest = days.reduce((most, d) => Math.max(most, d.episodes), 0);
  return {
    episodes: countOf(report?.episodes), answered: countOf(report?.answered),
    answeredPct: Number.isFinite(report?.answered_rate) ? Math.round(report.answered_rate * 100) : null,
    median: durationOf(report?.median_response_sec), p90: durationOf(report?.p90_response_sec),
    escalated: countOf(report?.escalated), unanswered: countOf(report?.unanswered), pending: countOf(report?.pending),
    perDay: days.map((d) => ({ date: d.date, episodes: d.episodes, share: busiest > 0 ? d.episodes / busiest : 0 })),
    perKind: listOf(report?.per_kind).filter((k) => typeof k?.kind === "string").map((k) => ({
      kind: k.kind, episodes: countOf(k.episodes), answered: countOf(k.answered), escalated: countOf(k.escalated),
      median: durationOf(k.median_response_sec),
    })),
    truncated: report?.truncated === true,
    windowFromMs: windowStart(report),
  };
}

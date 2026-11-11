// ozet.test.js — G4-02 «Yönetici özeti» (spec D5), the pure half: the per-unit join of every source, the «Birimi belli
// olmayan» row, «—» with a reason for a missing, failed or stale source (never 0), the oldest handover's age, the cards,
// and the alarm-quality box's figures; the caller's reach over the units table (GET /scope/me, and the live board's own
// scope for its alarm column); and the shape a read must have to be counted at all. A fixed clock; synthetic units,
// cards and monitors only.
import { describe, it, expect } from "vitest";
import { CONNECTION } from "../../../liveConnection.js";
import { SHADOW_PHASE } from "../../data/shadowStore.js";
import { bed, strip, unassigned } from "../../data/shadow.testutil.js";
import { scopedTo } from "../../data/board.testutil.js";
import { NEO, REA, structure } from "../kabul/kabul.testutil.js";
import {
  NO_UNIT, WHY, ageOf, boardReachSource, boardSource, durationOf, isPendingAnswer, isScopeAnswer, isTasksAnswer, lateOf,
  noSource, okSource, qualityView, reachSource, readSource, rightsOf, shadowSource, structureSource, summarise,
  wholePercent,
} from "./ozet.js";

const NOW = Date.parse("2026-11-11T10:00:00Z");
const MIN = 60_000;
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();

// The live board as the adapter shapes it (liveAdapters.js): a patient's unit is `unitId`, an alarm names its patient.
const PATIENTS = [{ patient_id: "S-1", unitId: REA }, { patient_id: "S-2", unitId: NEO }, { patient_id: "S-3", unitId: null }];
const alarm = (patientId, kind, severity, over = {}) => ({
  id: `${patientId}::${kind}`, patientId, kind, severity, ack: false, status: "FIRED", downgraded: false, ...over,
});
const ALERTS = [
  alarm("S-1", "septic_shock", "critical"), alarm("S-1", "news2", "high"),
  alarm("S-1", "acute_change", "moderate", { ack: true, status: "ACKNOWLEDGED" }),     // answered: not waiting
  alarm("S-2", "news2", "moderate"), alarm("S-3", "news2", "high"),
];
const liveBoard = (over = {}) => boardSource({ connection: CONNECTION.LIVE, patients: PATIENTS, alerts: ALERTS, nowMs: NOW, ...over }, true);

// GET /tasks: S-1 a late vital and a late hand task (and one on time), S-2 a vital due (not late), S-3 on no unit.
const TASKS = { patients: [
  { patient_id: "S-1", unit_id: REA, vital: { state: "late" }, tasks: [{ id: "t1", late: true }, { id: "t2", late: false }] },
  { patient_id: "S-2", unit_id: NEO, vital: { state: "due" }, tasks: [] },
  { patient_id: "S-3", unit_id: null, vital: null, tasks: [{ id: "t3", late: true }] },
] };
// GET /handovers/pending: two waiting in Reanimasiya, the oldest signed two days and an hour before the answer.
const PENDING = { generated_at: iso(0), units: [
  { unit_id: REA, unit_name: "Reanimasiya", pending: 2, oldest_outgoing_signed_at: iso(49 * 60 * MIN) },
] };
// The shadow board with G4-01's ledger: Reanimasiya's monitor 1 silent for 7 min, its monitor 2 sending, Neonatal's
// sending, and an unassigned monitor silent for 3 min.
const ledger = (beds, devices = [], feed = {}) => ({
  ...strip({ beds, unassigned: devices, feed }), generated_at: iso(0), watching_since: iso(60 * MIN),
  stale_list_after_s: 60, stale_list_until_s: 3600, vanished: [],
});
const silentFor = (minutes) => ({ status: "silent", last_packet_at: iso(minutes * MIN), silent_for_s: minutes * 60, channels_seen: [] });
const SENDING = { status: "streaming", last_packet_at: iso(0), channels_seen: [] };
const STRIP = ledger([
  bed("REA · 1", [], { unit_id: REA, ...silentFor(7) }), bed("REA · 2", [], { unit_id: REA, ...SENDING }),
  bed("NEO · 3", [], { unit_id: NEO, ...SENDING }),
], [unassigned("192.0.2.40", "not_in_table", [], silentFor(3))]);
const fresh = (data, over = {}) => ({ phase: SHADOW_PHASE.OK, data, fetchedAtMs: NOW, nowMs: NOW + 1000, ...over });
const REPORT = {
  episodes: 12, answered: 9, unanswered: 2, escalated: 1, pending: 1, answered_rate: 0.8182,
  median_response_sec: 42.4, p90_response_sec: 185, truncated: false, window_from: iso(6 * 24 * 60 * MIN),
  per_kind: [{ kind: "news2", episodes: 8, answered: 6, escalated: 1, unanswered: 1, pending: 1, median_response_sec: 40 }],
  per_day: [{ date: "2026-11-09", episodes: 4 }, { date: "2026-11-10", episodes: 8 }],
  noisiest_beds: [{ patient_id: "S-1", episodes: 5 }], per_patient_hour: [],
};
// The board's scope block (GET /patients `scope`): an administrator's, which reaches every unit.
const UNRESTRICTED = { unrestricted: true, reason: "unrestricted_role", unit_ids: [], bed_ids: [], own_patients: 0 };
// GET /scope/me (scope/schemas.py ScopeView), built as the board's scope is: an administrator's, and a scoped caller's.
const ME_ALL = { user_id: "u-1", role: "hospital_admin", unrestricted: true, reason: "role", unit_ids: [], bed_ids: [],
  grants: [], own_patients: 0 };
const meScoped = (unitIds, over = {}) => ({ ...ME_ALL, role: "nurse", unrestricted: false, reason: "assigned",
  unit_ids: unitIds, ...over });
const reachOf = (me) => reachSource(okSource(me, NOW));
const SOURCES = {
  tree: structure(), occupancy: okSource(structure()), board: liveBoard(), tasks: okSource(TASKS, NOW),
  pending: okSource(PENDING, NOW), shadow: shadowSource(fresh(STRIP), true), quality: okSource(REPORT, NOW),
  reach: reachOf(ME_ALL), boardReach: boardReachSource(UNRESTRICTED, liveBoard()), wholeTree: false,
};
/** Every per-unit cell of a row that is out of the caller's reach. */
const NO_RIGHT = { why: WHY.noRight };

describe("the units table: every source joined per unit", () => {
  it("counts each unit's beds, waiting alarms, overdue work, waiting handovers and silent monitors", () => {
    const { rows } = summarise(SOURCES);
    expect(rows.map((r) => r.name)).toEqual(["Reanimasiya", "Neonatal"]);
    const [rea, neo] = rows;
    expect(rea).toEqual({
      key: REA, name: "Reanimasiya", closed: false,
      occupancy: { occupied: 1, usable: 4, free: 2, cleaning: 1, reserved: 0, outOfService: 0, maintenance: 0 },
      waiting: { value: 2, critical: 1, high: 1 }, late: { value: 2 },
      pending: { value: 2, age: { unit: "day", n: 2 } }, silent: { value: 1 },
    });
    // A closed unit is listed, said closed, with its zeros — each from a source that answered.
    expect(neo).toMatchObject({ closed: true, waiting: { value: 1, critical: 0, high: 0 }, late: { value: 0 },
      pending: { value: 0, age: null }, silent: { value: 0 } });
  });

  it("gathers what no unit of the tree claims in «Birimi belli olmayan»", () => {
    const { unplaced } = summarise(SOURCES);
    expect(unplaced).toEqual({ key: NO_UNIT, occupancy: null, waiting: { value: 1, critical: 0, high: 1 },
      late: { value: 1 }, pending: { value: 0, age: null }, silent: { value: 1 } });
  });

  it("puts an id the tree does not hold there too, and draws that row only when it counts something", () => {
    const elsewhere = { patients: [{ patient_id: "S-9", unit_id: "REA-01", vital: { state: "late" }, tasks: [] }] };
    const quiet = { ...SOURCES, board: liveBoard({ alerts: [] }), shadow: shadowSource(fresh(ledger([])), true) };
    expect(summarise({ ...quiet, tasks: okSource(elsewhere, NOW) }).unplaced.late).toEqual({ value: 1 });
    expect(summarise({ ...quiet, tasks: okSource({ patients: [] }, NOW) }).unplaced).toBeNull();
  });

  it("has no rows when no tree was ever read — it cannot say which units there are", () => {
    const summary = summarise({ ...SOURCES, tree: null, occupancy: noSource(WHY.failed) });
    expect(summary.rows).toBeNull();
    expect(summary.unplaced).toBeNull();
    expect(summary.cards.late).toEqual({ value: 3 });            // the cards do not need the tree
  });
});

describe("the «Unutulan işler» cards", () => {
  it("count from each source: unanswered for the period, waiting handovers and the oldest's age, overdue work, silent monitors", () => {
    expect(summarise(SOURCES).cards).toEqual({
      unanswered: { value: 2, truncated: false },
      pending: { value: 2, age: { unit: "day", n: 2 } },
      late: { value: 3 },
      silent: { value: 2, longest: 7, noMonitors: false },
    });
    expect(summarise(SOURCES).reachNote).toBeNull();         // an unrestricted caller's counts are the hospital's
  });

  it("say the unanswered count came from a truncated read — an incomplete count is not a complete one", () => {
    const truncated = okSource({ ...REPORT, truncated: true }, NOW);
    expect(summarise({ ...SOURCES, quality: truncated }).cards.unanswered).toEqual({ value: 2, truncated: true });
  });

  it("say a view with no monitor has none silent, from a fresh answer", () => {
    const { silent } = summarise({ ...SOURCES, shadow: shadowSource(fresh(ledger([])), true) }).cards;
    expect(silent).toEqual({ value: 0, longest: null, noMonitors: true });
  });
});

describe("«—» with a reason, never an invented 0 (Decision 18)", () => {
  it("gives every card and every cell of a source that did not answer its reason, and no number", () => {
    const summary = summarise({
      tree: structure(), occupancy: noSource(WHY.failed), board: noSource(WHY.stale), tasks: noSource(WHY.loading),
      pending: noSource(WHY.failed), shadow: noSource(WHY.chain), quality: noSource(WHY.noRight),
      reach: SOURCES.reach, wholeTree: false,
    });
    expect(summary.cards).toEqual({ unanswered: { why: WHY.noRight }, pending: { why: WHY.failed },
      late: { why: WHY.loading }, silent: { why: WHY.chain } });
    for (const row of summary.rows) {
      expect(row).toMatchObject({ occupancy: { why: WHY.failed }, waiting: { why: WHY.stale }, late: { why: WHY.loading },
        pending: { why: WHY.failed }, silent: { why: WHY.chain } });
    }
    expect(summary.unplaced).toBeNull();
  });

  it("does not read a report that carries no `unanswered` as 0", () => {
    expect(summarise({ ...SOURCES, quality: okSource({ episodes: 3 }, NOW) }).cards.unanswered).toEqual({ why: WHY.unknown });
  });

  it("counts the live board only while it is LIVE", () => {
    expect(liveBoard().ok).toBe(true);
    expect(liveBoard({ connection: CONNECTION.DEGRADED })).toEqual(noSource(WHY.stale));
    expect(liveBoard({ connection: CONNECTION.CONNECTING })).toEqual(noSource(WHY.loading));
    expect(liveBoard({ connection: CONNECTION.UNAVAILABLE })).toEqual(noSource(WHY.failed));
    expect(boardSource({ connection: CONNECTION.LIVE, patients: [], alerts: [], nowMs: NOW }, false)).toEqual(noSource(WHY.noRight));
  });

  it("counts the shadow board only from a fresh answer whose chain works", () => {
    expect(shadowSource(fresh(STRIP), false)).toEqual(noSource(WHY.noRight));
    expect(shadowSource({ phase: SHADOW_PHASE.LOADING, data: null, fetchedAtMs: null, nowMs: NOW }, true)).toEqual(noSource(WHY.loading));
    expect(shadowSource({ phase: SHADOW_PHASE.UNREADABLE, data: null, fetchedAtMs: null, nowMs: NOW }, true)).toEqual(noSource(WHY.failed));
    expect(shadowSource(fresh({ stage: "off" }), true)).toEqual(noSource(WHY.stripOff));
    // Not fresh: the strip's own reason, never the live board's «pano güncel değil».
    expect(shadowSource(fresh(STRIP, { nowMs: NOW + 20_000 }), true)).toEqual(noSource(WHY.stripStale));           // past 15 s
    expect(shadowSource(fresh(STRIP, { phase: SHADOW_PHASE.UNREADABLE }), true)).toEqual(noSource(WHY.stripStale)); // the last poll failed
    expect(shadowSource(fresh(ledger(STRIP.beds, [], { state: "forwarder_silent" })), true)).toEqual(noSource(WHY.chain));
    expect(shadowSource(fresh(ledger(STRIP.beds, [], { state: "some_new_state" })), true)).toEqual(noSource(WHY.unknown));
  });

  it("counts the silent monitors by status alone from an API without the ledger, with no longest silence", () => {
    const old = strip({ beds: [bed("REA · 1", [], { unit_id: REA, status: "silent" }), bed("REA · 2", [], { unit_id: REA })] });
    const source = shadowSource(fresh({ ...old, generated_at: iso(0) }), true);
    expect(summarise({ ...SOURCES, shadow: source }).cards.silent).toEqual({ value: 1, longest: null, noMonitors: false });
  });

  it("names why the page's own reads and the tree have no answer", () => {
    expect(readSource({ phase: "ok", data: TASKS, atMs: NOW }, true)).toEqual(okSource(TASKS, NOW));
    expect(readSource({ phase: "loading" }, true)).toEqual(noSource(WHY.loading));
    expect(readSource({ phase: "failed", error: Object.assign(new Error("x"), { status: 503 }) }, true)).toEqual(noSource(WHY.failed));
    expect(readSource({ phase: "failed", error: Object.assign(new Error("x"), { status: 403 }) }, true)).toEqual(noSource(WHY.noRight));
    expect(readSource({ phase: "ok", data: TASKS }, false)).toEqual(noSource(WHY.noRight));
    expect(structureSource({ phase: "known", structure: { sites: [] } }, true)).toEqual(okSource({ sites: [] }));
    expect(structureSource({ phase: "stale", structure: { sites: [] } }, true)).toEqual(noSource(WHY.failed));
    expect(structureSource({ phase: "loading", structure: null }, true)).toEqual(noSource(WHY.loading));
    expect(structureSource({ phase: "unasked", structure: null }, true)).toEqual(noSource(WHY.noRight));
    // A refused tree is no right, not a failure — with or without an older tree held.
    const refused = Object.assign(new Error("x"), { status: 403 });
    expect(structureSource({ phase: "stale", structure: { sites: [] }, error: refused }, true)).toEqual(noSource(WHY.noRight));
    expect(structureSource({ phase: "failed", structure: null, error: refused }, true)).toEqual(noSource(WHY.noRight));
    expect(structureSource({ phase: "failed", structure: null, error: Object.assign(new Error("x"), { status: 503 }) }, true))
      .toEqual(noSource(WHY.failed));
  });

  it("knows which sources a session may read, and whether its tree is the whole hospital's", () => {
    expect(rightsOf(["summary.view"])).toEqual({ structure: false, board: false, tasks: false, pending: true, shadow: false,
      quality: false, wholeTree: false });
    expect(rightsOf(["summary.view", "board.view", "audit.view", "tasks.view", "admissions.view"]))
      .toEqual({ structure: true, board: true, tasks: true, pending: true, shadow: true, quality: true, wholeTree: false });
    expect(rightsOf(["summary.view", "structure.manage"])).toMatchObject({ structure: true, wholeTree: true });
  });
});

// Every source but the tree is cut to the caller's reach by the server (the board and /tasks by her scope, the waiting
// handovers by her unit grants, the shadow board by her beds); the tree is cut too — except for `structure.manage`,
// which sees the whole hospital, and a unit reached through a bed grant alone is listed with that bed only. So a unit
// outside her unit grants is no answer about that unit: «yetki yok», never a 0 (Decision 18). The reach is read from
// GET /scope/me, which any signed-in user may call; the alarm column keeps the live board's own scope, from the same
// answer as its counts.
describe("the caller's reach over the units table", () => {
  const COUNTED = ["waiting", "late", "pending", "silent"];
  /** A caller whose /scope/me and board scope agree, as they are built alike. */
  const scoped = (me, over = {}) => summarise({ ...SOURCES, reach: reachOf(me),
    boardReach: boardReachSource(me.unrestricted ? UNRESTRICTED : scopedTo(me.unit_ids, { bed_ids: me.bed_ids }), liveBoard()),
    ...over });

  it("an unrestricted scope reaches every unit: the table and the cards as they are, no caveat", () => {
    const summary = scoped(ME_ALL);
    expect(summary.rows).toEqual(summarise(SOURCES).rows);
    expect(summary.rows[1]).toMatchObject({ waiting: { value: 1 }, late: { value: 0 }, silent: { value: 0 } });
    expect(summary.unplaced).not.toBeNull();
    expect(summary.reachNote).toBeNull();
  });

  it("a unit grant: the granted unit counts; another says «yetki yok» in every column, its beds too", () => {
    const summary = scoped(meScoped([REA.toUpperCase()]));               // the grant as the scope holds it, any case
    const [rea, neo] = summary.rows;
    expect(rea).toEqual(summarise(SOURCES).rows[0]);
    expect(neo).toEqual({ key: NEO, name: "Neonatal", closed: true, occupancy: NO_RIGHT,
      waiting: NO_RIGHT, late: NO_RIGHT, pending: NO_RIGHT, silent: NO_RIGHT });
    expect(summary.unplaced).toBeNull();                                   // a row no unit of hers claims is not hers to count
    expect(summary.cards).toEqual(summarise(SOURCES).cards);               // the cards count what she was sent…
    expect(summary.reachNote).toBe("scoped");                              // …and say it is only her reach
  });

  it("a bed grant alone reaches no unit whole: every unit says «yetki yok», its beds too", () => {
    const summary = scoped(meScoped([], { bed_ids: ["44444444-4444-4444-8444-444444444402"] }));
    for (const row of summary.rows) {
      expect(row).toMatchObject({ occupancy: NO_RIGHT, waiting: NO_RIGHT, late: NO_RIGHT, pending: NO_RIGHT, silent: NO_RIGHT });
    }
    expect(summary.unplaced).toBeNull();
    expect(summary.reachNote).toBe("scoped");
  });

  it("structure.manage with a unit grant: the tree is whole, so another unit's beds are counted, and nothing else", () => {
    const summary = scoped(meScoped([REA]), { wholeTree: true });
    const [rea, neo] = summary.rows;
    expect(rea).toEqual(summarise(SOURCES).rows[0]);
    expect(neo.occupancy).toEqual(summarise(SOURCES).rows[1].occupancy);
    for (const cell of COUNTED) expect(neo[cell], cell).toEqual(NO_RIGHT);
  });

  it("without board.view: only the alarm column says «yetki yok»; tasks, handovers, monitors and beds are real", () => {
    const noBoard = noSource(WHY.noRight);
    const summary = summarise({ ...SOURCES, board: noBoard, boardReach: boardReachSource(UNRESTRICTED, noBoard) });
    const [rea, neo] = summary.rows;
    expect(rea).toEqual({ ...summarise(SOURCES).rows[0], waiting: NO_RIGHT });
    expect(neo).toMatchObject({ waiting: NO_RIGHT, late: { value: 0 }, pending: { value: 0, age: null }, silent: { value: 0 } });
    expect(neo.occupancy).toEqual(summarise(SOURCES).rows[1].occupancy);
    expect(summary.cards).toEqual(summarise(SOURCES).cards);
    expect(summary.reachNote).toBeNull();
  });

  it("the live board unavailable for an unrestricted administrator: only the alarm column says why", () => {
    const down = liveBoard({ connection: CONNECTION.UNAVAILABLE });
    const summary = summarise({ ...SOURCES, board: down, boardReach: boardReachSource(null, down) });
    for (const [i, row] of summary.rows.entries()) {
      expect(row).toEqual({ ...summarise(SOURCES).rows[i], waiting: { why: WHY.failed } });
    }
    expect(summary.cards).toEqual(summarise(SOURCES).cards);
    expect(summary.reachNote).toBeNull();
  });

  it("while /scope/me has not answered: the cells it decides say «okunuyor…», the alarms follow the board, no caveat", () => {
    const loading = { ...SOURCES, reach: reachSource(noSource(WHY.loading)) };
    const summary = summarise(loading);
    for (const row of summary.rows) {
      expect(row).toMatchObject({ occupancy: { why: WHY.loading }, late: { why: WHY.loading }, pending: { why: WHY.loading },
        silent: { why: WHY.loading } });
    }
    expect(summary.rows.map((row) => row.waiting)).toEqual(summarise(SOURCES).rows.map((row) => row.waiting));
    expect(summary.unplaced).toBeNull();
    expect(summary.reachNote).toBeNull();                                  // nothing flashes before the reach is known
    expect(summary.cards).toEqual(summarise(SOURCES).cards);
    // A whole tree's beds need no reach.
    expect(summarise({ ...loading, wholeTree: true }).rows[0].occupancy).toEqual(summarise(SOURCES).rows[0].occupancy);
  });

  it("when /scope/me failed: its own reason in those cells, and a neutral caveat on the cards", () => {
    const summary = summarise({ ...SOURCES, reach: reachSource(noSource(WHY.failed)) });
    for (const row of summary.rows) {
      expect(row).toMatchObject({ occupancy: { why: WHY.failed }, late: { why: WHY.failed }, pending: { why: WHY.failed },
        silent: { why: WHY.failed } });
    }
    expect(summary.reachNote).toBe("unknown");
  });

  it("reads the reach from /scope/me, and the alarm column's from the board's own scope", () => {
    expect(reachOf(ME_ALL)).toEqual(okSource({ all: true, units: null }));
    expect(reachOf(meScoped([" REA-01 ", "Neo"])).data.units).toEqual(new Set(["rea-01", "neo"]));
    expect(reachSource(noSource(WHY.failed))).toEqual(noSource(WHY.failed));
    expect(reachSource(okSource({ unrestricted: "yes" }, NOW))).toEqual(noSource(WHY.failed));
    expect(boardReachSource(UNRESTRICTED, liveBoard())).toEqual(okSource({ all: true, units: null }));
    // A scope kept from the last load still holds while the board is not LIVE.
    expect(boardReachSource(UNRESTRICTED, liveBoard({ connection: CONNECTION.DEGRADED })).ok).toBe(true);
    expect(boardReachSource(UNRESTRICTED, noSource(WHY.noRight))).toEqual(noSource(WHY.noRight));
    expect(boardReachSource(null, liveBoard({ connection: CONNECTION.UNAVAILABLE }))).toEqual(noSource(WHY.failed));
    expect(boardReachSource(null, liveBoard())).toEqual(noSource(WHY.unknown));               // an answer without its scope
  });
});

// Plan N10: an answer of the wrong shape is a failed read, never a partial count — one malformed entry and the whole
// read says «okunamadı», because skipping it would show its unit a 0.
describe("the shape a read must have to be counted", () => {
  it("/tasks: a list of patients, each with a list of hand tasks that say whether they are late, and a vital or none", () => {
    expect(isTasksAnswer(TASKS)).toBe(true);
    expect(isTasksAnswer({ patients: [] })).toBe(true);
    const patient = TASKS.patients[0];
    for (const bad of [
      null, {}, { patients: {} }, { patients: [null] },
      { patients: [{ ...patient, tasks: null }] }, { patients: [{ ...patient, tasks: "t1" }] },
      { patients: [{ ...patient, tasks: [{ id: "t1" }] }] }, { patients: [{ ...patient, tasks: [{ id: "t1", late: "yes" }] }] },
      { patients: [{ ...patient, vital: "late" }] }, { patients: [{ ...patient, vital: {} }] },
      { patients: [{ ...patient, unit_id: 7 }] },
    ]) expect(isTasksAnswer(bad), JSON.stringify(bad)).toBe(false);
  });

  it("/handovers/pending: units with a whole count and a readable time, and the server's time", () => {
    expect(isPendingAnswer(PENDING)).toBe(true);
    expect(isPendingAnswer({ units: [], generated_at: iso(0) })).toBe(true);
    const unit = PENDING.units[0];
    for (const bad of [
      null, {}, { units: [] }, { units: [], generated_at: "yesterday" }, { units: {}, generated_at: iso(0) },
      { units: [null], generated_at: iso(0) }, { units: [{ ...unit, pending: "2" }], generated_at: iso(0) },
      { units: [{ ...unit, pending: 1.5 }], generated_at: iso(0) }, { units: [{ ...unit, pending: -1 }], generated_at: iso(0) },
      { units: [{ ...unit, unit_id: null }], generated_at: iso(0) },
      { units: [{ ...unit, oldest_outgoing_signed_at: "long ago" }], generated_at: iso(0) },
    ]) expect(isPendingAnswer(bad), JSON.stringify(bad)).toBe(false);
    expect(isPendingAnswer({ units: [{ ...unit, oldest_outgoing_signed_at: null }], generated_at: iso(0) })).toBe(true);
  });

  it("/scope/me: whether the scope is unrestricted, and its unit grants as text", () => {
    expect(isScopeAnswer(ME_ALL)).toBe(true);
    expect(isScopeAnswer(meScoped([REA]))).toBe(true);
    for (const bad of [
      null, {}, [], { ...ME_ALL, unrestricted: "true" }, { ...ME_ALL, unrestricted: undefined },
      { ...ME_ALL, unit_ids: null }, { ...ME_ALL, unit_ids: "rea" }, meScoped([REA, 7]),
    ]) expect(isScopeAnswer(bad), JSON.stringify(bad)).toBe(false);
  });
});

describe("what is counted", () => {
  it("overdue work: the server's late hand tasks and a late vital — not a due one, not one on time", () => {
    expect(TASKS.patients.map(lateOf)).toEqual([2, 0, 1]);
    expect(lateOf({ vital: { state: "plan" }, tasks: [{ late: false }, { state: "done" }] })).toBe(0);
  });

  it("an age in whole minutes, hours or days, floored, by the server's clock", () => {
    expect(ageOf(NOW - 59 * MIN, NOW)).toEqual({ unit: "min", n: 59 });
    expect(ageOf(NOW - 60 * MIN, NOW)).toEqual({ unit: "hour", n: 1 });
    expect(ageOf(NOW - (24 * 60 - 1) * MIN, NOW)).toEqual({ unit: "hour", n: 23 });
    expect(ageOf(NOW - 24 * 60 * MIN, NOW)).toEqual({ unit: "day", n: 1 });
    expect(ageOf(NOW + 5 * MIN, NOW)).toEqual({ unit: "min", n: 0 });     // a clock a little behind: never negative
    expect(ageOf(null, NOW)).toBeNull();
  });
});

describe("the alarm-quality box", () => {
  it("draws the report's figures, a rate only when something settled, and each day's bar against the busiest", () => {
    const view = qualityView(REPORT);
    expect(view).toMatchObject({ episodes: 12, answered: 9, answeredPct: 82, escalated: 1, unanswered: 2, pending: 1,
      median: { m: null, s: 42 }, p90: { m: 3, s: 5 }, truncated: false });
    expect(view.perDay).toEqual([{ date: "2026-11-09", episodes: 4, share: 0.5 }, { date: "2026-11-10", episodes: 8, share: 1 }]);
    expect(view.perKind).toEqual([{ kind: "news2", episodes: 8, answered: 6, escalated: 1, median: { m: null, s: 40 } }]);
    expect(JSON.stringify(view)).not.toContain("S-1");                  // no patient-level field is carried
  });

  it("keeps the engine's null rate null, and a figure the answer lacks null — never 0", () => {
    const view = qualityView({ episodes: 2, answered: 0, unanswered: 0, pending: 2, answered_rate: null, median_response_sec: null });
    expect(view.answeredPct).toBeNull();
    expect(view.median).toBeNull();
    expect(view.escalated).toBeNull();
    expect(view.perDay).toEqual([]);
  });

  // G4-03 review: a whole percent rounded plainly says «%100» with an alarm left unanswered (299 of 300) and «%0» with
  // one answered (1 of 300). The edges belong to «all» and «none» only.
  it("writes 100% only when every settled episode was answered, and 0% only when none was", () => {
    const of = (answered, unanswered) => qualityView({ ...REPORT, answered, unanswered,
      answered_rate: Math.round((answered / (answered + unanswered)) * 10_000) / 10_000 }).answeredPct;
    expect([of(299, 1), of(1, 299), of(300, 0), of(0, 300), of(9, 2)]).toEqual([99, 1, 100, 0, 82]);
    expect([wholePercent(0.9967, 299, 300), wholePercent(0.0033, 1, 300), wholePercent(1, 4, 4), wholePercent(0, 0, 4)])
      .toEqual([99, 1, 100, 0]);
    expect(wholePercent(1, 19_999, 20_000)).toBe(99);                    // the engine's 4-decimal rate rounds up to 1
    expect([wholePercent(0.9967, null, null), wholePercent(0.0033, null, null), wholePercent(null, 1, 2)])
      .toEqual([99, 1, null]);                                            // without the counts, the rate's own side
  });

  it("says a truncated read is one, from when it counts", () => {
    const view = qualityView({ ...REPORT, truncated: true, window_from: "2026-11-08T06:00:00+00:00" });
    expect(view.truncated).toBe(true);
    expect(view.windowFromMs).toBe(Date.parse("2026-11-08T06:00:00+00:00"));
    expect(durationOf(59.6)).toEqual({ m: 1, s: 0 });
  });
});

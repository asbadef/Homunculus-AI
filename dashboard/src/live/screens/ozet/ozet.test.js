// ozet.test.js — G4-02 «Yönetici özeti» (spec D5), the pure half: the per-unit join of every source, the «Birimi belli
// olmayan» row, «—» with a reason for a missing, failed or stale source (never 0), the oldest handover's age, the cards,
// and the alarm-quality box's figures. A fixed clock; synthetic units, cards and monitors only.
import { describe, it, expect } from "vitest";
import { CONNECTION } from "../../../liveConnection.js";
import { SHADOW_PHASE } from "../../data/shadowStore.js";
import { bed, strip, unassigned } from "../../data/shadow.testutil.js";
import { NEO, REA, structure } from "../kabul/kabul.testutil.js";
import {
  NO_UNIT, WHY, ageOf, boardSource, durationOf, lateOf, noSource, okSource, qualityView, readSource, rightsOf,
  shadowSource, structureSource, summarise,
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
  per_kind: [{ kind: "news2", episodes: 8, answered: 6, escalated: 1, unanswered: 1, pending: 1, repeats: 0, median_response_sec: 40 }],
  per_day: [{ date: "2026-11-09", episodes: 4 }, { date: "2026-11-10", episodes: 8 }],
  noisiest_beds: [{ patient_id: "S-1", episodes: 5 }], per_patient_hour: [],
};
const SOURCES = {
  tree: structure(), occupancy: okSource(structure()), board: liveBoard(), tasks: okSource(TASKS, NOW),
  pending: okSource(PENDING, NOW), shadow: shadowSource(fresh(STRIP), true), quality: okSource(REPORT, NOW),
};

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
      unanswered: { value: 2 },
      pending: { value: 2, age: { unit: "day", n: 2 } },
      late: { value: 3 },
      silent: { value: 2, longest: 7, noMonitors: false },
    });
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
    expect(shadowSource(fresh(STRIP, { nowMs: NOW + 20_000 }), true)).toEqual(noSource(WHY.stale));           // past 15 s
    expect(shadowSource(fresh(STRIP, { phase: SHADOW_PHASE.UNREADABLE }), true)).toEqual(noSource(WHY.stale)); // the last poll failed
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
  });

  it("knows which sources a session may read", () => {
    expect(rightsOf(["summary.view"])).toEqual({ structure: false, board: false, tasks: false, pending: true, shadow: false, quality: false });
    expect(rightsOf(["summary.view", "board.view", "audit.view", "tasks.view", "admissions.view"]))
      .toEqual({ structure: true, board: true, tasks: true, pending: true, shadow: true, quality: true });
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

  it("says a truncated read is one, from when it counts", () => {
    const view = qualityView({ ...REPORT, truncated: true, window_from: "2026-11-08T06:00:00+00:00" });
    expect(view.truncated).toBe(true);
    expect(view.windowFromMs).toBe(Date.parse("2026-11-08T06:00:00+00:00"));
    expect(durationOf(59.6)).toEqual({ m: 1, s: 0 });
  });
});

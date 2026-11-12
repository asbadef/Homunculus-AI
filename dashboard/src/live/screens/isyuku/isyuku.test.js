// isyuku.test.js — G4-04 «İş yükü» (spec D6, §5 A4–A6, A10, A11, A13), the pure half: the round's read (the shift, then
// /tasks over its week) and its two sources (a shift that has ended is «nöbet değişti»); the rows (the tree's open
// units) with each cell from its sources or why not — the reach, the units the GET lists, «Bu nöbet için atama yok»
// only from a fresh listing; «Geciken iş» and «Kalan iş»; the nurse cards (alphabetical, beds, patients and «Kalan iş»
// only, found through the board) and the unassigned beds; the form's beds, people and body. Synthetic ward
// (isyuku.testutil.js); the board in the adapter's shape, as ozet.test.js writes it.
import { describe, it, expect, vi } from "vitest";
import { CONNECTION } from "../../../liveConnection.js";
import { WHY, noSource, okSource } from "../ozet/ozet.js";
import {
  ALL, SHIFT_CHANGED, boardWork, formModel, isNursesAnswer, isScheduleAnswer, labelled, listedKeysOf, meanOf, readWork,
  remainingOf, saveBody, workSources, workloadPage, workloadRights,
} from "./isyuku.js";
import { BED, NEO, NOW_MS, NURSE, NURSES, REA, schedule, tasks, tree, unitSchedule } from "./isyuku.testutil.js";

const PATIENTS = [{ patient_id: "S-101", unitId: REA, bedId: BED(1) }, { patient_id: "S-102", unitId: REA, bedId: BED(2) },
  { patient_id: "S-105", unitId: REA, bedId: BED(5) }, { patient_id: "S-111", unitId: NEO, bedId: BED(11) }];
const alarm = (patientId, kind, severity, over = {}) => ({
  id: `${patientId}::${kind}`, patientId, kind, severity, ack: false, status: "FIRED", downgraded: false, ...over,
});
const ALERTS = [alarm("S-101", "septic_shock", "critical"), alarm("S-105", "news2", "high"),
  alarm("S-105", "acute_change", "moderate", { ack: true, status: "ACKNOWLEDGED" })];      // answered: not waiting
const LIVE = { connection: CONNECTION.LIVE, patients: PATIENTS, alerts: ALERTS, nowMs: NOW_MS };
const EVERY = okSource({ all: true, units: null });
const RIGHTS = workloadRights(["workload.view", "shifts.manage", "tasks.view", "board.view", "admissions.view"]);
const read = (data) => ({ phase: "ok", data, atMs: NOW_MS, error: null });

function sources(over = {}) {
  return { tree: tree(), occupancy: okSource(tree()), reach: EVERY, wholeTree: false, schedule: okSource(schedule()),
    tasks: okSource(tasks()), board: boardWork(LIVE, true), ...over };
}
const page = (over = {}, options = {}) => workloadPage(sources(over), { lang: "az", ...options });
const cellsOf = (p) => Object.fromEntries(p.rows.map((row) => [row.name, row.cells]));

describe("the round's read and its sources", () => {
  it("reads the current shift, then /tasks over the week that ends with it", async () => {
    const api = { shiftSchedule: vi.fn().mockResolvedValue(schedule()), tasks: vi.fn().mockResolvedValue(tasks()) };
    expect(await readWork(api, true)).toEqual({ schedule: schedule(), tasks: { ok: true, data: tasks() } });
    expect(api.shiftSchedule).toHaveBeenCalledWith("current");
    expect(api.tasks).toHaveBeenCalledWith("2026-11-05T20:00:00.000Z", "2026-11-12T20:00:00Z");
    api.tasks.mockClear();
    expect(await readWork(api, false)).toEqual({ schedule: schedule(), tasks: null });
    expect(api.tasks).not.toHaveBeenCalled();
  });

  it("keeps the schedule when the task read fails, and says why for the tasks alone", async () => {
    const refused = Object.assign(new Error("no"), { status: 403 });
    const api = { shiftSchedule: vi.fn().mockResolvedValue(schedule()), tasks: vi.fn().mockRejectedValue(refused) };
    const work = await readWork(api, true);
    expect(work.tasks).toEqual({ ok: false, error: refused });
    const { schedule: s, tasks: t } = workSources(read(work), RIGHTS, NOW_MS);
    expect([s.ok, t]).toEqual([true, noSource(WHY.noRight)]);
  });

  it("takes the shift's answer only whole, and calls one whose shift has ended «nöbet değişti» — tasks too", () => {
    expect(isScheduleAnswer(schedule())).toBe(true);
    for (const bad of [null, { ...schedule(), shift: { ...schedule().shift, which: "C" } }, { ...schedule(), generated_at: "x" },
      schedule({ units: [{ unit_id: REA, unit_name: "Reanimasiya", other_rows: 0, items: [{ bed_id: BED(1), nurse_id: 7 }] }] }),
      schedule({ units: [{ unit_id: REA, unit_name: "Reanimasiya", other_rows: -1, items: [] }] })]) {
      expect(isScheduleAnswer(bad)).toBe(false);
    }
    const fresh = workSources(read({ schedule: schedule(), tasks: { ok: true, data: tasks() } }), RIGHTS, NOW_MS);
    expect([fresh.schedule.ok, fresh.tasks.ok]).toEqual([true, true]);
    const after = Date.parse("2026-11-12T20:00:00Z");
    expect(workSources(read({ schedule: schedule(), tasks: { ok: true, data: tasks() } }), RIGHTS, after))
      .toEqual({ schedule: noSource(SHIFT_CHANGED), tasks: noSource(SHIFT_CHANGED) });
    const short = { ...tasks(), patients: [{ patient_id: "S-1", unit_id: REA, vital: null, tasks: [{ id: "t", late: false }] }] };
    expect(workSources(read({ schedule: schedule(), tasks: { ok: true, data: short } }), RIGHTS, NOW_MS).tasks)
      .toEqual(noSource(WHY.failed));
    expect(isNursesAnswer(NURSES)).toBe(true);
    expect(isNursesAnswer([{ id: "n-1", name: "x" }])).toBe(false);
  });

  it("asks for the shift with either key, and reads /tasks only with tasks.view", () => {
    expect(workloadRights(["shifts.manage"])).toMatchObject({ schedule: true, manage: true, tasks: false });
    expect(workloadRights(["workload.view"])).toMatchObject({ schedule: true, manage: false });
    expect(workloadRights(["summary.view"]).schedule).toBe(false);
  });
});

describe("the units for this shift", () => {
  it("joins every source per open unit of the tree, in its order — a closed unit is left out", () => {
    const p = page();
    expect(p.rows.map((row) => row.name)).toEqual(["Reanimasiya", "Neonatal"]);
    expect(p.shift).toEqual({ startMs: Date.parse("2026-11-12T08:00:00Z"), endMs: Date.parse("2026-11-12T20:00:00Z"), which: "A" });
    expect(cellsOf(p).Reanimasiya).toEqual({
      patients: { value: 4 },                       // 1, 2, 3 (leaving: still a patient) and 5; never the closed bed
      nurses: { value: 2 },                         // Leyla and Aysel; Zaur's row is on a closed bed
      ratio: { patients: 3, nurses: 2 },            // the occupied beds that have a nurse: 1, 2, 5
      unassigned: { value: 1 },                     // bed 3
      late: { value: 2 },                           // the late hand task and the late vital (§5 A4)
      remaining: { value: 2 },                      // open, not late, due before the shift ends: t2 and t6 — not t4
      waiting: { value: 2 },                        // the critical and the high; the answered one is not
    });
    expect(meanOf(3, 2)).toBe(1.5);
    expect(p.otherRows).toBe(false);
  });

  it("says a listed unit has no assignment this shift — never «0 hemşire» — and still counts its unassigned patients", () => {
    expect(cellsOf(page()).Neonatal).toEqual({
      patients: { value: 1 }, nurses: { none: true }, ratio: { none: true }, unassigned: { value: 1 },
      late: { value: 0 }, remaining: { value: 1 }, waiting: { value: 0 },
    });
  });

  it("counts «Kalan iş» from open hand tasks not late, due before the shift ends", () => {
    const end = Date.parse("2026-11-12T20:00:00Z");
    const at = (due, over = {}) => ({ tasks: [{ state: "open", late: false, due_at: due, ...over }] });
    expect(remainingOf(at("2026-11-12T19:59:00Z"), end)).toBe(1);
    expect(remainingOf(at("2026-11-12T20:00:00Z"), end)).toBe(0);
    expect(remainingOf(at("2026-11-12T09:00:00Z", { late: true }), end)).toBe(0);
    expect(remainingOf(at("2026-11-12T12:00:00Z", { state: "done" }), end)).toBe(0);
  });

  it("says so when the shift hours changed meanwhile (other windows' rows)", () => {
    const s = schedule();
    s.units[1].other_rows = 2;
    expect(page({ schedule: okSource(s) }).otherRows).toBe(true);
  });
});

describe("Decision 18: every number is real or says why not (§5 A6)", () => {
  it("a unit the GET does not list: «yetki yok» in its assignment cells — never «atama yok»", () => {
    const s = schedule({ units: [schedule().units[1]] });          // Neonatal not listed
    const neo = cellsOf(page({ schedule: okSource(s) })).Neonatal;
    expect([neo.nurses, neo.ratio, neo.unassigned]).toEqual(Array(3).fill({ why: WHY.noRight }));
    expect([neo.patients, neo.late, neo.waiting]).toEqual([{ value: 1 }, { value: 0 }, { value: 0 }]);
  });

  it("a unit outside her reach: «yetki yok» in every counted cell, its beds too unless the tree is whole", () => {
    const reach = okSource({ all: false, units: new Set([REA.toLowerCase()]) });
    const neo = cellsOf(page({ reach, schedule: okSource(schedule({ units: [schedule().units[1]] })) })).Neonatal;
    expect(Object.values(neo)).toEqual(Array(7).fill({ why: WHY.noRight }));
    const whole = cellsOf(page({ reach, wholeTree: true, schedule: okSource(schedule({ units: [schedule().units[1]] })) })).Neonatal;
    expect(whole.patients).toEqual({ value: 1 });
  });

  it("a missing or ended shift: the assignment cells, the tasks and the cards say why", () => {
    for (const why of [WHY.noRight, SHIFT_CHANGED]) {
      const p = page({ schedule: noSource(why), tasks: noSource(why) });
      expect(p.shift).toBeNull();
      const rea = cellsOf(p).Reanimasiya;
      expect([rea.nurses, rea.ratio, rea.unassigned, rea.late, rea.remaining]).toEqual(Array(5).fill({ why }));
      expect([rea.patients, rea.waiting]).toEqual([{ value: 4 }, { value: 2 }]);
      expect([p.cards, p.cardsWhy, p.shiftWhy]).toEqual([null, why, why]);
    }
  });

  it("a board that is not LIVE: the alarm column and the cards' «Kalan iş» say why (§5 A5)", () => {
    const board = boardWork({ ...LIVE, connection: CONNECTION.DEGRADED }, true);
    expect(board).toEqual(noSource(WHY.stale));
    const p = page({ board });
    expect(cellsOf(p).Reanimasiya.waiting).toEqual({ why: WHY.stale });
    expect(cellsOf(p).Reanimasiya.remaining).toEqual({ value: 2 });      // the unit's own: /tasks names its unit
    const leyla = p.cards.find((card) => card.label === "Leyla Sentetik");
    expect([leyla.patients, leyla.tasks]).toEqual([{ value: 2 }, { why: WHY.stale }]);
  });

  it("a tree held from an older read whose latest failed: the patients, the ratio and the unassigned say why", () => {
    const p = page({ occupancy: noSource(WHY.failed) });
    const rea = cellsOf(p).Reanimasiya;
    expect([rea.patients, rea.ratio, rea.unassigned]).toEqual(Array(3).fill({ why: WHY.failed }));
    expect(rea.nurses).toEqual({ value: 2 });
    expect(p.unassigned).toEqual({ why: WHY.failed });
  });

  it("no rows without a tree — the tree's own reason", () => {
    expect(page({ tree: null, occupancy: noSource(WHY.loading) })).toMatchObject({ rows: null, why: WHY.loading });
    expect(page({ tree: null, occupancy: noSource(WHY.noRight) })).toMatchObject({ rows: null, why: WHY.noRight });
  });
});

// Review 3: the alarm column and the cards' «Kalan iş» are counted from the live board, so they keep the board's own
// scope (ozet.js `boardReachSource`), not GET /scope/me: the board's scope is renewed only with the board.
describe("the board's own scope (review 3)", () => {
  const NIGAR_ON_N1 = { bed_id: BED(11), nurse_id: NURSE.nigar, nurse_name: "Nigar Sentetik", nurse_username: "nigar@sentetik.example" };

  it("a unit /scope/me reaches but the board's scope does not yet: «yetki yok» there, never a 0", () => {
    const s = schedule();
    s.units[0].items = [NIGAR_ON_N1];
    const boardReach = okSource({ all: false, units: new Set([REA.toLowerCase()]) });
    const p = page({ schedule: okSource(s), boardReach });
    expect(cellsOf(p).Neonatal.waiting).toEqual({ why: WHY.noRight });
    expect(cellsOf(p).Reanimasiya.waiting).toEqual({ value: 2 });
    expect(cellsOf(p).Neonatal.remaining).toEqual({ value: 1 });          // /tasks: her own reach, which holds it
    expect(p.cards.find((card) => card.label === "Nigar Sentetik").tasks).toEqual({ why: WHY.noRight });
    expect(p.cards.find((card) => card.label === "Leyla Sentetik").tasks).toEqual({ value: 2 });
  });

  it("a board scope not known: the alarm column and the cards' «Kalan iş» say why", () => {
    const p = page({ boardReach: noSource(WHY.unknown) });
    expect(cellsOf(p).Reanimasiya.waiting).toEqual({ why: WHY.unknown });
    expect(cellsOf(p).Reanimasiya.late).toEqual({ value: 2 });
    expect(p.cards.map((card) => card.tasks)).toEqual([{ why: WHY.unknown }, { why: WHY.unknown }]);
  });
});

describe("the nurse cards (§5 A5, A11, A13)", () => {
  it("one card per nurse with a bed there, alphabetical: her beds, her patients and their «Kalan iş» — nothing else", () => {
    const { cards } = page();
    expect(cards).toEqual([
      { key: NURSE.aysel, label: "Aysel Sentetik", beds: ["5 · Otaq 2 · Reanimasiya"], patients: { value: 1 }, tasks: { value: 0 } },
      { key: NURSE.leyla, label: "Leyla Sentetik", beds: ["1 · Otaq 1 · Reanimasiya", "2 · Otaq 1 · Reanimasiya"],
        patients: { value: 2 }, tasks: { value: 2 } },
    ]);
  });

  it("then the occupied beds nobody has; one unit chosen narrows both, a choice no listed row holds falls back to all", () => {
    expect(page().unassigned).toEqual({ beds: ["3 · Otaq 1 · Reanimasiya", "N1 · N-1 · Neonatal"] });
    const neo = page({}, { selected: NEO.toLowerCase() });
    expect([neo.selected, neo.cards, neo.unassigned]).toEqual([NEO.toLowerCase(), [], { beds: ["N1 · N-1 · Neonatal"] }]);
    expect(page({}, { selected: "a unit the rows do not hold" }).selected).toBe(ALL);
  });

  // Review 2 (§5 A6): an answer that lists no unit is no answer about any card or bed — «yetki yok», never «none».
  it("says «yetki yok» for the cards and the unassigned beds when the answer lists no unit", () => {
    const p = page({ schedule: okSource(schedule({ units: [] })) });
    expect([p.cards, p.cardsWhy, p.unassigned, p.partial]).toEqual([null, WHY.noRight, { why: WHY.noRight }, false]);
    expect(cellsOf(p).Reanimasiya.patients).toEqual({ value: 4 });       // the table still counts what the tree says
  });

  it("says the cards cover only the listed units when «Tüm birimler» leaves some out", () => {
    expect(page().partial).toBe(false);
    const s = okSource(schedule({ units: [schedule().units[1]] }));     // Neonatal not listed
    expect(page({ schedule: s }).partial).toBe(true);
    expect(page({ schedule: s }, { selected: REA.toLowerCase() }).partial).toBe(false);
    expect(page({ schedule: noSource(WHY.failed) }).partial).toBe(false);
  });

  // Review 1 (§5 A7): a poll that fails, or a shift that ends, must not take the unit picker — and with it the form
  // being edited — away; only a fresh answer that leaves the unit out falls back to «Tüm birimler».
  it("keeps the units the last fresh answer listed while the next read is not ok", () => {
    const kept = new Set([NEO.toLowerCase(), REA.toLowerCase()]);
    expect(listedKeysOf(schedule())).toBe(`${NEO.toLowerCase()} ${REA.toLowerCase()}`);
    for (const why of [WHY.failed, SHIFT_CHANGED]) {
      const p = page({ schedule: noSource(why), tasks: noSource(why) }, { selected: REA.toLowerCase(), kept });
      expect(p.selected).toBe(REA.toLowerCase());
      expect(p.choices.map((row) => row.name)).toEqual(["Reanimasiya", "Neonatal"]);
      expect([p.cards, p.cardsWhy]).toEqual([null, why]);
    }
    const withoutRea = okSource(schedule({ units: [schedule().units[0]] }));
    expect(page({ schedule: withoutRea }, { selected: REA.toLowerCase(), kept }).selected).toBe(ALL);
    expect(page({ schedule: noSource(WHY.loading) }, { selected: REA.toLowerCase() }).selected).toBe(ALL);   // none kept
  });

  it("tells two of one name apart by their user names, and sorts in the reader's language", () => {
    expect(labelled([{ key: "1", name: "Leyla", username: "leyla.a" }, { key: "2", name: "Leyla", username: "leyla.b" },
      { key: "3", name: "Aysel", username: "aysel" }]).map((p) => p.label)).toEqual(["Leyla (leyla.a)", "Leyla (leyla.b)", "Aysel"]);
    const s = schedule();
    s.units[1].items[2] = { ...s.units[1].items[2], nurse_name: "Leyla Sentetik" };           // Aysel's row, renamed
    expect(page({ schedule: okSource(s) }).cards.map((card) => card.label))
      .toEqual(["Leyla Sentetik (aysel@sentetik.example)", "Leyla Sentetik (leyla@sentetik.example)"]);
  });
});

describe("the form's model and its body (§5 A7, A10)", () => {
  const rea = () => page().rows.find((row) => row.name === "Reanimasiya");

  it("one picker per open bed, the rows read chosen; the people by name, one who cannot see the unit marked", () => {
    const model = formModel({ row: rea(), schedule: unitSchedule("current", REA), nurses: [...NURSES], lang: "az" });
    expect(model.beds.map((bed) => [bed.label, bed.held])).toEqual([
      ["1 · Otaq 1 · Reanimasiya", NURSE.leyla], ["2 · Otaq 1 · Reanimasiya", NURSE.leyla],
      ["3 · Otaq 1 · Reanimasiya", ""], ["4 · Otaq 1 · Reanimasiya", ""], ["5 · Otaq 2 · Reanimasiya", NURSE.aysel]]);
    expect(model.beds[2].people.map((person) => [person.label, person.note]))
      .toEqual([["Aysel Sentetik", null], ["Leyla Sentetik", null], ["Nigar Sentetik", "unreached"]]);
    expect(model.expected).toEqual([{ bed_id: BED(1), nurse_id: NURSE.leyla }, { bed_id: BED(2), nurse_id: NURSE.leyla },
      { bed_id: BED(5), nurse_id: NURSE.aysel }, { bed_id: BED(6), nurse_id: NURSE.zaur }]);    // the closed bed's row too
  });

  it("offers a person no longer offered only on the bed she holds, marked", () => {
    const answer = unitSchedule("current", REA);
    answer.units[0].items.push({ bed_id: BED(4), nurse_id: NURSE.zaur, nurse_name: "Zaur Sentetik", nurse_username: "zaur@sentetik.example" });
    const model = formModel({ row: rea(), schedule: answer, nurses: [...NURSES], lang: "az" });
    const four = model.beds.find((bed) => bed.label.startsWith("4 "));
    expect(four.people.map((person) => [person.label, person.note]).at(-1)).toEqual(["Zaur Sentetik", "gone"]);
    expect(model.beds[0].people.map((person) => person.key)).not.toContain(NURSE.zaur);
  });

  it("sends the window's key, the chosen pairs, and every row read as `expected`", () => {
    const model = formModel({ row: rea(), schedule: unitSchedule("current", REA), nurses: [...NURSES], lang: "az" });
    const choices = new Map(model.beds.map((bed) => [bed.key, bed.held]));
    choices.set(model.beds[2].key, NURSE.nigar);
    expect(saveBody(model, choices)).toEqual({ unit_id: REA, shift_start: "2026-11-12T08:00:00Z",
      items: [{ bed_id: BED(1), nurse_id: NURSE.leyla }, { bed_id: BED(2), nurse_id: NURSE.leyla },
        { bed_id: BED(3), nurse_id: NURSE.nigar }, { bed_id: BED(5), nurse_id: NURSE.aysel }],
      expected: model.expected });
  });
});

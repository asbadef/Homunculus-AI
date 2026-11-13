// enfeksiyon.test.js — «Enfeksiyon kontrol» (G4-05, spec D10–D15 as §5 S1, A3, A4, M3, M4 amend them), pure: the
// isolation beds drawn from the tree — every tile state, a closed bed, room or unit not drawn, the tally — the unit
// selection (a no-unit row only under «Tüm birimler», a unit an answer does not list counts 0), both orders by name,
// the «Birim» and «Oda» cells, and Decision 18 for the counts, the tiles and the alarm cell.
import { describe, it, expect } from "vitest";
import { indexStructure } from "../../data/structure.js";
import {
  ALL, TILES, alarmItems, bedTally, countCell, freeBedsCell, isolationBeds, roomCell, selectionOf, sortRows, tileOf,
  tileWords, unitChoices, unitOf,
} from "./enfeksiyon.js";
import {
  ALI, AYSE, BED, ELIF, KAMRAN, LEYLA, MURAD, NEO, NIGAR, REA, REA_COUNTS, UNNAMED, answer, at, row, tree,
} from "./enfeksiyon.testutil.js";

const ids = (rows) => rows.map((r) => r.patient_id);
const NAMES = new Map([[REA, "Reanimasiya"], [NEO, "Neonatal"], ["u-a", "A birimi"]]);
const order = (over = {}) => ({ unitOf: (r) => unitOf(r, indexStructure(tree())), unitName: (id) => NAMES.get(id) ?? id,
  lang: "tr", ...over });

describe("the isolation beds, from the tree (§5 S1, A4)", () => {
  const tiles = isolationBeds(tree(), answer());
  const byLabel = Object.fromEntries(tiles.map((tile) => [tile.label, tile]));

  it("draws every open bed of an open isolation room of an open unit, in the tree's order", () => {
    expect(tiles.map((tile) => tile.label)).toEqual(["İzo 1", "İzo 2", "İzo 3", "İzo 4", "İzo 5", "İzo 6", "İzo 7",
      "İzo 8", "İzo 9", "İzo 10"]);                    // İzo 11 is closed; İzolasyon 2 is closed; Neonatal is closed
    expect(byLabel["İzo 1"]).toMatchObject({ roomName: "İzolasyon 1", unitId: REA, state: "OCCUPIED" });
  });

  it("decides each tile from the tree's state and who lies on the bed", () => {
    expect(Object.fromEntries(tiles.map((tile) => [tile.label, tile.tile]))).toEqual({
      "İzo 1": "isolated", "İzo 2": "free", "İzo 3": "occupant_unseen", "İzo 4": "cleaning", "İzo 5": "reserved",
      "İzo 6": "out_of_service", "İzo 7": "maintenance", "İzo 8": "not_isolated", "İzo 9": "unrecorded",
      "İzo 10": "conflict" });
    expect(byLabel["İzo 1"].occupants).toEqual([{ patient_id: "S-101", display_name: "Ayşe Sentetik", state: "isolated",
      types: ["contact", "droplet"] }]);
    expect(byLabel["İzo 10"].occupants.map((o) => o.patient_id)).toEqual(["S-108"]);
  });

  it("calls a bed with two patients isolated when one is, and an occupied bed of unknown occupants by its own word", () => {
    const two = [{ state: "not_isolated", types: [] }, { state: "isolated", types: ["contact"] }];
    expect(tileOf("OCCUPIED", two)).toBe("isolated");
    expect(tileOf("OCCUPIED", [{ state: "not_isolated", types: [] }, { state: "unrecorded", types: [] }])).toBe("unrecorded");
    expect(tileOf("PENDING_TRANSFER_OUT", [{ state: "not_isolated", types: [] }])).toBe("not_isolated");
    expect(tileOf("OCCUPIED", [{ state: "quarantine", types: [] }])).toBe("unknown");
    expect(tileOf("BLOCKED", [{ state: "isolated", types: [] }])).toBe("conflict");      // never «kullanım dışı» over a patient
    expect(tileOf("NEW_STATE", [])).toBe("unknown");
    expect(TILES).not.toContain("unknown");
  });

  it("counts the tiles: free ones, and those whose bed state has a patient — a conflict is in neither", () => {
    expect(bedTally(tiles)).toEqual({ total: 10, free: 1, occupied: 4 });
    expect(bedTally([])).toEqual({ total: 0, free: 0, occupied: 0 });
  });

  it("draws no tile when no room isolates, and none from a tree that is not one", () => {
    expect(isolationBeds(tree({ isolation: false }), answer())).toEqual([]);
    expect(isolationBeds(null, answer())).toEqual([]);
    expect(isolationBeds(tree(), null).map((tile) => tile.tile)).toContain("occupant_unseen");
  });
});

describe("the unit selection (spec D13 item 1, §5 S1, M4)", () => {
  it("offers the tree's open units and the units of the answer, each once", () => {
    expect(unitChoices(tree(), answer({ units: [{ unit_id: "u-a", counts: {} }] }))).toEqual([REA, "u-a"]);
    expect(unitChoices(null, answer())).toEqual([REA]);
    expect(unitChoices(tree(), null)).toEqual([REA]);                     // Neonatal is closed
  });

  it("takes the whole answer for «Tüm birimler», and a unit's own counts and rows for one unit", () => {
    const all = selectionOf(answer(), ALL);
    expect(all.counts).toEqual(answer().counts);
    expect(ids(all.isolated)).toEqual(["S-101", "S-104", "S-105", "S-108"]);
    const rea = selectionOf(answer(), REA);
    expect(rea.counts).toEqual(REA_COUNTS);
    expect(ids(rea.isolated)).toEqual(["S-101", "S-104", "S-108"]);      // the no-unit row is under «Tüm birimler» only
    expect(ids(rea.suspected)).toEqual(["S-101", "S-102", "S-103", "S-107"]);
  });

  it("counts 0 for a unit the answer does not list: it has no scoped card", () => {
    expect(selectionOf(answer(), "u-a").counts).toEqual({ patients: 0, isolated: 0, isolation_unrecorded: 0,
      suspected: 0, suspected_unrecorded: 0, clock_missed: 0, sepsis_open: 0 });
    expect(selectionOf(null, ALL)).toEqual({ counts: null, isolated: [], suspected: [] });
  });
});

describe("the order, by the names a reader sees (§5 M4)", () => {
  it("orders the isolated by unit name, no unit last, then the bed label as the board does, then the key", () => {
    expect(ids(sortRows(answer().isolated, order()))).toEqual(["S-104", "S-101", "S-108", "S-105"]);
    const other = row("S-109", { unit_id: "u-a", bed_label: "İzo 2" });
    expect(ids(sortRows([...answer().isolated, other], order()))).toEqual(["S-109", "S-104", "S-101", "S-108", "S-105"]);
  });

  it("orders the suspected by the server's group, an open clock by the time left, then the same unit, bed and key", () => {
    expect(ids(sortRows(answer().suspected, order({ byGroup: true })))).toEqual(["S-103", "S-102", "S-101", "S-107"]);
    const firing = row("S-110", { bed_label: "9", suspected_infection: true, sort_group: 1 });
    expect(ids(sortRows([LEYLA, firing, ELIF, ALI, AYSE], order({ byGroup: true }))))
      .toEqual(["S-103", "S-102", "S-110", "S-101", "S-107"]);
  });

  it("puts a bed-only row under its bed's unit (§5 M4) and a row with neither last", () => {
    const bedOnly = row("S-111", { unit_id: null, bed_id: BED(11), bed_label: "İzo 1" });
    expect(unitOf(bedOnly, indexStructure(tree()))).toBe(REA);
    expect(unitOf(MURAD, indexStructure(tree()))).toBeNull();
    expect(unitOf(bedOnly, indexStructure(null))).toBeNull();
  });
});

describe("the «Oda» cell (§5 S1, A4 b)", () => {
  const index = indexStructure(tree());

  it("says whether the row's bed is in an isolation room", () => {
    expect(roomCell(AYSE, index, true)).toEqual({ key: "enfeksiyon.room.yes" });
    expect(roomCell(UNNAMED, index, true)).toEqual({ key: "enfeksiyon.room.no" });
  });

  it("says why it cannot: no bed, a bed the tree does not hold, a tree that is not read", () => {
    expect(roomCell(MURAD, index, true)).toEqual({ why: "enfeksiyon.room.noBed" });
    expect(roomCell(row("S-112", { bed_id: "55555555-5555-4555-8555-555555555599" }), index, true))
      .toEqual({ why: "enfeksiyon.room.unknownBed" });                 // never «izolasyon odasında değil»
    expect(roomCell(AYSE, index, false)).toEqual({ why: "tree" });
  });
});

describe("Decision 18 for the counts (spec D15, §5 A3)", () => {
  it("prints a fresh answer's number, 0 included", () => {
    expect(countCell(0, true)).toEqual({ value: 0 });
    expect(countCell(3, true)).toEqual({ value: 3 });
  });

  it("keeps a number above 0 from an answer that is not fresh, and turns its 0 into «—» «liste güncel değil»", () => {
    expect(countCell(3, false)).toEqual({ value: 3, stale: true });
    expect(countCell(0, false)).toEqual({ dash: true, why: "enfeksiyon.notFresh" });
  });

  it("never prints what is no count", () => {
    for (const value of [undefined, null, -1, 1.5, "2"]) expect(countCell(value, true), String(value)).toEqual({ dash: true });
  });

  it("words the free isolation beds from the tree, and «—» with the reason when it cannot", () => {
    const ok = { ok: true };
    expect(freeBedsCell({ total: 10, free: 1, occupied: 4 }, true, ok)).toEqual({ free: 1, total: 10 });
    expect(freeBedsCell({ total: 0, free: 0, occupied: 0 }, true, ok)).toEqual({ dash: true, why: "enfeksiyon.count.noRooms" });
    expect(freeBedsCell({ total: 10, free: 3, occupied: 4 }, false, ok)).toEqual({ dash: true, why: "enfeksiyon.notFresh" });
    expect(freeBedsCell(null, true, { ok: false, why: "failed" })).toEqual({ dash: true, why: "tree" });
  });
});

describe("Decision 18 for the tiles (§5 A4 c)", () => {
  const tiles = Object.fromEntries(isolationBeds(tree(), answer()).map((tile) => [tile.tile, tile]));

  it("words every tile from a fresh answer", () => {
    expect(tileWords(tiles.free, true)).toEqual({ key: "enfeksiyon.beds.tile.free" });
    expect(tileWords(tiles.isolated, true)).toEqual({ key: "enfeksiyon.beds.tile.isolated", lastAnswer: false });
    expect(tileWords(tiles.occupant_unseen, true))
      .toEqual({ key: "enfeksiyon.beds.tile.occupant_unseen", why: "enfeksiyon.beds.tile.occupantUnseenWhy" });
    expect(tileWords(tiles.conflict, true)).toEqual({ key: "enfeksiyon.beds.tile.conflict", stateKey: "kabul.state.AVAILABLE" });
    expect(tileWords(tiles.out_of_service, true)).toEqual({ key: "enfeksiyon.beds.tile.out_of_service" });
    expect(tileWords({ tile: "unknown", state: "NEW_STATE" }, true)).toEqual({ key: "enfeksiyon.unknown", state: "NEW_STATE" });
  });

  it("never says «boş», «izolasyonsuz» or «kayıt yok» from an answer that is not fresh", () => {
    for (const quiet of ["free", "not_isolated", "unrecorded"]) {
      expect(tileWords(tiles[quiet], false), quiet).toEqual({ dash: true, why: "enfeksiyon.notFresh" });
    }
    expect(tileWords(tiles.isolated, false)).toEqual({ key: "enfeksiyon.beds.tile.isolated", lastAnswer: true });
    expect(tileWords(tiles.cleaning, false)).toEqual({ key: "enfeksiyon.beds.tile.cleaning" });     // the tree's own word
  });
});

describe("the alarm cell (spec D13 item 6, §5 A6, M3)", () => {
  it("names each alarm by its kind, toned by its severity, latched, acknowledged or snoozed", () => {
    const r = row("S-113", { sepsis_alarms: [
      { kind: "septic_shock", severity: "critical", first_seen_at: at(70), resolved_at: at(10), acknowledged: false, snooze_until: null },
      { kind: "sepsis", severity: "high", first_seen_at: at(70), resolved_at: null, acknowledged: true, snooze_until: null },
      { kind: "under_resuscitated_sepsis", severity: "high", first_seen_at: at(70), resolved_at: null, acknowledged: false,
        snooze_until: at(-15) },
      { kind: "new_kind", severity: "moderate", first_seen_at: null, resolved_at: null, acknowledged: false, snooze_until: null }] });
    expect(alarmItems(r)).toEqual([
      { kind: "septic_shock", kindKey: "enfeksiyon.kind.septicShock", tone: "crit", latched: true, acknowledged: false, snoozeMs: null },
      { kind: "sepsis", kindKey: "enfeksiyon.kind.sepsis", tone: "high", latched: false, acknowledged: true, snoozeMs: null },
      { kind: "under_resuscitated_sepsis", kindKey: "enfeksiyon.kind.underResuscitated", tone: "high", latched: false,
        acknowledged: false, snoozeMs: Date.parse(at(-15)) },
      { kind: "new_kind", kindKey: null, tone: "mid", latched: false, acknowledged: false, snoozeMs: null }]);
    expect(alarmItems(NIGAR)).toEqual([]);
    expect(alarmItems(KAMRAN)).toEqual([]);
  });
});

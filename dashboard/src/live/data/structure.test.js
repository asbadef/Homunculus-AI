// The ward's structure, read (Group 2 · B1a): every unit and bed by name, never by UUID, and only
// an open, AVAILABLE bed offered to an admission.
import { describe, it, expect } from "vitest";
import { DICTIONARIES } from "../i18n/catalog.js";
import { createTranslator } from "../i18n/translate.js";
import {
  EMPTY_INDEX, admissible, bedLabel, bedNamer, indexStructure, isUuid, unavailableKey, unitLabel, unitNamer,
} from "./structure.js";
import { BED, NEO, REA, structure } from "../screens/kabul/kabul.testutil.js";

const az = createTranslator("az", DICTIONARIES);

describe("the structure's index", () => {
  const index = indexStructure(structure());

  it("finds every unit, room and bed with its parents' names", () => {
    expect(index.units.get(REA)).toMatchObject({ name: "Reanimasiya", unitType: "ADULT_ICU", isActive: true, siteName: "Ana bina" });
    expect(index.beds.get(BED(5))).toMatchObject({ label: "5", roomName: "Otaq 2", unitName: "Reanimasiya", open: true });
    expect(index.beds.size).toBe(6);
  });

  // The fixture's ids are all digits, so upper-casing them proves nothing: this tree's ids carry
  // hex letters, and is asked in the other case than it was written in.
  it("finds an id whatever its case, as the engine compares ids", () => {
    const written = "ABCDEF01-2345-4678-8ABC-DEF012345678";
    const bedWritten = "FEDCBA98-7654-4321-8FED-CBA987654321";
    const tree = indexStructure({ sites: [{ name: "S", units: [{ id: written, name: "Yoğun bakım", rooms: [
      { id: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA", name: "Otaq", beds: [{ id: bedWritten, label: "7", state: "AVAILABLE" }] }] }] }] });
    expect(unitLabel(az, tree, written.toLowerCase())).toBe("Yoğun bakım");
    expect(unitLabel(az, tree, ` ${written} `)).toBe("Yoğun bakım");
    expect(bedLabel(tree, bedWritten.toLowerCase())).toBe("7 · Yoğun bakım");
    expect(unitLabel(az, index, REA.toUpperCase())).toBe("Reanimasiya");
  });

  it("calls a bed open only when it, its room and its unit are open", () => {
    expect(index.beds.get(BED(4)).open).toBe(false);          // the bed is closed
    expect(index.beds.get(BED(6)).open).toBe(false);          // its unit is closed
    expect(index.beds.get(BED(1)).open).toBe(true);
  });

  it("is empty for an answer that is not a tree", () => {
    for (const answer of [null, undefined, {}, { sites: "x" }]) expect(indexStructure(answer).beds.size).toBe(0);
  });
});

describe("a unit's name", () => {
  const index = indexStructure(structure());

  it("is the structure's name", () => {
    expect(unitLabel(az, index, NEO)).toBe("Neonatal");
  });

  it("is never a UUID: an id the tree does not hold reads «unknown unit»", () => {
    const label = unitLabel(az, index, "99999999-9999-4999-8999-999999999999");
    expect(label).toBe(az("kabul.unitUnknown"));
    expect(isUuid(label)).toBe(false);
  });

  it("keeps a key someone wrote by hand (an old free-text grant): it is no UUID", () => {
    expect(unitLabel(az, index, "unit-adult")).toBe("unit-adult");
  });
});

describe("which bed an admission may take", () => {
  const index = indexStructure(structure());

  it("only an open, AVAILABLE one", () => {
    expect(admissible(index.beds.get(BED(1)))).toBe(true);
    for (const n of [2, 3, 4, 6]) expect(admissible(index.beds.get(BED(n))), n).toBe(false);
  });

  it("says why each other one is not offered, closed before its state", () => {
    expect(unavailableKey(index.beds.get(BED(1)))).toBeNull();
    expect(unavailableKey(index.beds.get(BED(2)))).toBe("kabul.state.OCCUPIED");
    expect(unavailableKey(index.beds.get(BED(3)))).toBe("kabul.state.HOUSEKEEPING");
    expect(unavailableKey(index.beds.get(BED(4)))).toBe("kabul.bedClosed");
    expect(unavailableKey(index.beds.get(BED(6)))).toBe("kabul.bedClosed");
  });

  it("names a bed by its label and its unit", () => {
    expect(bedLabel(index, BED(5))).toBe("5 · Reanimasiya");
    expect(bedLabel(index, "nope")).toBeNull();
  });
});

const GHOST = "99999999-9999-4999-8999-999999999999";
const GHOST_2 = "99999999-9999-4999-8999-999999999998";
const known = { index: indexStructure(structure()), known: true };
/** The structure not read (yet, or at all): an empty index that must not be mistaken for a
 *  structure that has no such unit. */
const pending = { index: EMPTY_INDEX, known: false };

describe("the units of a list, named", () => {
  it("by the structure's names, shown in the order of those names, not of the ids", () => {
    const names = unitNamer(az, known, [REA, NEO], "az");
    expect(names.nameOf(REA)).toBe("Reanimasiya");
    expect(names.nameOf(NEO)).toBe("Neonatal");
    expect(names.sorted).toEqual([NEO, REA]);
  });

  it("by a numbered placeholder while the structure is not known, never as «unknown»", () => {
    const names = unitNamer(az, pending, [REA, NEO], "az");
    expect(names.nameOf(REA)).toBe("Şöbə 1");
    expect(names.nameOf(NEO)).toBe("Şöbə 2");
    expect(names.sorted).toEqual([REA, NEO]);
    for (const id of [REA, NEO]) expect(names.nameOf(id)).not.toBe(az("kabul.unitUnknown"));
  });

  it("says «unknown unit» only once the structure is known and lacks the id", () => {
    expect(unitNamer(az, known, [REA, GHOST], "az").nameOf(GHOST)).toBe(az("kabul.unitUnknown"));
    expect(unitNamer(az, pending, [REA, GHOST], "az").nameOf(GHOST)).toBe("Şöbə 2");
  });

  it("keeps a key someone typed by hand, as typed, and gives it no number", () => {
    const names = unitNamer(az, pending, [REA, "unit-adult", NEO], "az");
    expect(names.nameOf("unit-adult")).toBe("unit-adult");
    expect([names.nameOf(REA), names.nameOf(NEO)]).toEqual(["Şöbə 1", "Şöbə 2"]);
  });

  it("numbers colliding names, in the list's order, so two units never read alike", () => {
    const twins = structure();
    twins.sites[0].units[1].name = "Reanimasiya";
    const view = { index: indexStructure(twins), known: true };
    const names = unitNamer(az, view, [NEO, REA], "az");
    expect(names.nameOf(NEO)).toBe("Reanimasiya (1)");
    expect(names.nameOf(REA)).toBe("Reanimasiya (2)");
    const ghosts = unitNamer(az, known, [GHOST, GHOST_2], "az");
    expect(ghosts.nameOf(GHOST)).toBe(`${az("kabul.unitUnknown")} (1)`);
    expect(ghosts.nameOf(GHOST_2)).toBe(`${az("kabul.unitUnknown")} (2)`);
  });

  it("puts placeholders in numeric order (2 before 10), and counts an id once whatever its case", () => {
    const ids = Array.from({ length: 10 }, (_, i) => `00000000-0000-4000-8000-0000000000a${i}`);
    const names = unitNamer(az, pending, [...ids, ids[0].toUpperCase()], "az");
    expect(names.sorted).toEqual(ids);
    expect(names.nameOf(ids[9])).toBe("Şöbə 10");
  });
});

describe("the beds of a list, named", () => {
  it("by label and unit once known; «unknown bed» for an id the tree lacks", () => {
    const names = bedNamer(az, known, [BED(5), BED(1), GHOST], "az");
    expect(names.nameOf(BED(5))).toBe("5 · Reanimasiya");
    expect(names.nameOf(GHOST)).toBe(az("kabul.bedUnknown"));
    expect(names.sorted).toEqual([BED(1), BED(5), GHOST]);
  });

  it("by a numbered placeholder while the structure is not known, never as «unknown»", () => {
    const names = bedNamer(az, pending, [BED(5), "bed-7", BED(1)], "az");
    expect(names.nameOf(BED(5))).toBe("Çarpayı 1");
    expect(names.nameOf(BED(1))).toBe("Çarpayı 2");
    expect(names.nameOf("bed-7")).toBe("bed-7");
  });
});

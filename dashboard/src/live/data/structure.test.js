// The ward's structure, read (Group 2 · B1a): every unit and bed by name, never by UUID, and only
// an open, AVAILABLE bed offered to an admission.
import { describe, it, expect } from "vitest";
import { DICTIONARIES } from "../i18n/catalog.js";
import { createTranslator } from "../i18n/translate.js";
import {
  EMPTY_INDEX, admissible, bedLabel, bedNamer, indexStructure, isUuid, normId, ordinalRegistry, unavailableKey,
  unitNamer,
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
    const view = viewOf("known", tree);
    expect(unitNamer(az, view, [written.toLowerCase()], "az").nameOf(written.toLowerCase())).toBe("Yoğun bakım");
    expect(unitNamer(az, view, [` ${written} `], "az").nameOf(written)).toBe("Yoğun bakım");
    expect(bedLabel(tree, bedWritten.toLowerCase())).toBe("7 · Yoğun bakım");
    expect(unitNamer(az, known(), [REA.toUpperCase()], "az").nameOf(REA)).toBe("Reanimasiya");
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
/** The structure as StructureProvider gives it to a screen — its phase, its index, and the registry
 *  of placeholder numbers the one shell keeps (a new one for each test: a shell of its own). */
const viewOf = (phase, index) => ({ index, phase, ordinalOf: ordinalRegistry().ordinalOf });
const known = () => viewOf("known", indexStructure(structure()));
/** The structure not read (yet, or at all): an empty index that must not be mistaken for a
 *  structure that has no such unit. */
const pending = () => viewOf("loading", EMPTY_INDEX);
const idOf = (at) => `77777777-7777-4777-8777-77777777770${at}`;
/** A tree of units with these names, ids made up (`idOf`). */
const unitsNamed = (...names) => indexStructure({ sites: [{ name: "S", units: names.map((name, at) => ({
  id: idOf(at), name, rooms: [] })) }] });

describe("the units of a list, named", () => {
  it("by the structure's names, shown in the order of those names, not of the ids", () => {
    const names = unitNamer(az, known(), [REA, NEO], "az");
    expect(names.nameOf(REA)).toBe("Reanimasiya");
    expect(names.nameOf(NEO)).toBe("Neonatal");
    expect(names.sorted).toEqual([NEO, REA]);
  });

  it("by a numbered placeholder while the structure is not known, never as «unknown»", () => {
    const names = unitNamer(az, pending(), [REA, NEO], "az");
    expect(names.nameOf(REA)).toBe("Şöbə 1");
    expect(names.nameOf(NEO)).toBe("Şöbə 2");
    expect(names.sorted).toEqual([REA, NEO]);
    for (const id of [REA, NEO]) expect(names.nameOf(id)).not.toBe(az("kabul.unitUnknown"));
  });

  // «Unknown» is a claim about a unit, so it is numbered like every other nameless unit: with the
  // number the registry gave it, the one it had as a placeholder, not by its place in a list.
  it("says «unknown unit» only when the last read succeeded and the tree lacks the id — with its own number", () => {
    const names = unitNamer(az, known(), [REA, GHOST], "az");
    expect(names.nameOf(GHOST)).toBe(`${az("kabul.unitUnknown")} 1`);
    expect(isUuid(names.nameOf(GHOST))).toBe(false);
    expect(unitNamer(az, pending(), [REA, GHOST], "az").nameOf(GHOST)).toBe("Şöbə 2");
  });

  // A stale tree is the last answer, and a later read may have added a unit it lacks: it names
  // what it holds and numbers what it does not — it cannot call anything unknown.
  it("keeps the names a stale tree holds, and numbers an id it lacks instead of calling it unknown", () => {
    const names = unitNamer(az, viewOf("stale", indexStructure(structure())), [REA, GHOST], "az");
    expect(names.nameOf(REA)).toBe("Reanimasiya");
    expect(names.nameOf(GHOST)).toBe("Şöbə 1");
  });

  // The scope lists a unit the tree lacks: the structure is read again for it, and until that read
  // lands the tree is not yet an answer about that unit.
  it("does not call an id «unknown» while the read made for it is out, and does once that read has landed", () => {
    const view = { ...known(), rereading: new Set([normId(GHOST)]) };
    const names = unitNamer(az, view, [REA, GHOST, GHOST_2], "az");
    expect(names.nameOf(GHOST)).toBe("Şöbə 1");
    expect(names.nameOf(GHOST_2)).toBe(`${az("kabul.unitUnknown")} 2`);   // not asked for in that read
    expect(unitNamer(az, { ...view, rereading: new Set() }, [GHOST], "az").nameOf(GHOST))
      .toBe(`${az("kabul.unitUnknown")} 1`);
  });

  it("keeps a key someone typed by hand, as typed, and gives it no number", () => {
    const names = unitNamer(az, pending(), [REA, "unit-adult", NEO], "az");
    expect(names.nameOf("unit-adult")).toBe("unit-adult");
    expect([names.nameOf(REA), names.nameOf(NEO)]).toEqual(["Şöbə 1", "Şöbə 2"]);
    expect(unitNamer(az, known(), ["unit-adult"], "az").nameOf("unit-adult")).toBe("unit-adult");
  });

  it("numbers colliding names, in the list's order, so two units never read alike", () => {
    const twins = structure();
    twins.sites[0].units[1].name = "Reanimasiya";
    const names = unitNamer(az, viewOf("known", indexStructure(twins)), [NEO, REA], "az");
    expect(names.nameOf(NEO)).toBe("Reanimasiya (1)");
    expect(names.nameOf(REA)).toBe("Reanimasiya (2)");
  });

  it("numbers the units it calls «unknown» from the registry, not by position — two of them are 1 and 2", () => {
    const view = known();
    const ghosts = unitNamer(az, view, [GHOST, GHOST_2], "az");
    expect(ghosts.nameOf(GHOST)).toBe(`${az("kabul.unitUnknown")} 1`);
    expect(ghosts.nameOf(GHOST_2)).toBe(`${az("kabul.unitUnknown")} 2`);
    const later = unitNamer(az, view, [GHOST_2], "az");                       // the list shrinks: no renumbering
    expect(later.nameOf(GHOST_2)).toBe(`${az("kabul.unitUnknown")} 2`);
  });

  // The scope editor says "these names are placeholders" when any listed key is one — in every
  // phase that can make one, a partly named list included.
  it("counts the placeholders of a list, so a screen can say so", () => {
    expect(unitNamer(az, pending(), [REA, NEO, "unit-adult"], "az").placeholders).toBe(2);
    expect(unitNamer(az, viewOf("stale", indexStructure(structure())), [REA, GHOST], "az").placeholders).toBe(1);
    expect(unitNamer(az, { ...known(), rereading: new Set([normId(GHOST)]) }, [REA, GHOST], "az").placeholders).toBe(1);
    expect(unitNamer(az, known(), [REA, NEO, GHOST, "unit-adult"], "az").placeholders).toBe(0);   // «unknown» is a claim, not a placeholder
    expect(unitNamer(az, pending(), [], "az").placeholders).toBe(0);
  });

  it("never gives two units one name: a suffix already taken by a unit of that name is skipped", () => {
    const view = viewOf("known", unitsNamed("X", "X", "X (1)"));
    const names = unitNamer(az, view, [idOf(0), idOf(1), idOf(2)], "az");
    const shown = [0, 1, 2].map((at) => names.nameOf(idOf(at)));
    expect(shown).toEqual(["X (2)", "X (3)", "X (1)"]);
    expect(new Set(shown).size).toBe(3);
  });

  it("puts placeholders in numeric order (2 before 10), and counts an id once whatever its case", () => {
    const ids = Array.from({ length: 10 }, (_, i) => `00000000-0000-4000-8000-0000000000a${i}`);
    const names = unitNamer(az, pending(), [...ids, ids[0].toUpperCase()], "az");
    expect(names.sorted).toEqual(ids);
    expect(names.nameOf(ids[9])).toBe("Şöbə 10");
  });
});

// A placeholder is a way to tell two units apart on a screen where an administrator may act on
// one of them: its number must never move to another unit (Task 12 re-review, I-A).
describe("a placeholder's number", () => {
  const [A, B, C, D] = ["a", "b", "c", "d"].map((x) => `${x.repeat(8)}-${x.repeat(4)}-4${x.repeat(3)}-8${x.repeat(3)}-${x.repeat(12)}`);

  it("stays with its unit when the list around it changes — one removed, one that sorts first added", () => {
    const view = pending();
    expect(unitNamer(az, view, [A, B, C], "az").nameOf(B)).toBe("Şöbə 2");
    const without = unitNamer(az, view, [B, C], "az");                      // A's grant is removed
    expect([without.nameOf(B), without.nameOf(C)]).toEqual(["Şöbə 2", "Şöbə 3"]);
    const first = unitNamer(az, view, [D, A, B, C], "az");                  // a key that sorts before all
    expect(first.nameOf(D)).toBe("Şöbə 4");
    expect([first.nameOf(A), first.nameOf(B), first.nameOf(C)]).toEqual(["Şöbə 1", "Şöbə 2", "Şöbə 3"]);
  });

  it("is never reused while the shell is open: a unit that went and came back has its number again", () => {
    const view = pending();
    unitNamer(az, view, [A, B], "az");
    unitNamer(az, view, [B], "az");
    expect(unitNamer(az, view, [C], "az").nameOf(C)).toBe("Şöbə 3");
    expect(unitNamer(az, view, [A], "az").nameOf(A)).toBe("Şöbə 1");
  });

  it("is the same on every screen of one shell, whatever order each lists its units in", () => {
    const view = pending();
    const bar = unitNamer(az, view, [C, A], "az");
    const editor = unitNamer(az, view, [A, B, C], "az");
    expect([bar.nameOf(C), bar.nameOf(A)]).toEqual(["Şöbə 1", "Şöbə 2"]);
    expect([editor.nameOf(C), editor.nameOf(A), editor.nameOf(B)]).toEqual(["Şöbə 1", "Şöbə 2", "Şöbə 3"]);
  });

  it("is distinct for every id, one outside the list included, and the same each time it is asked", () => {
    const names = unitNamer(az, pending(), [A], "az");
    expect([names.nameOf(B), names.nameOf(C), names.nameOf(B)]).toEqual(["Şöbə 2", "Şöbə 3", "Şöbə 2"]);
  });

  it("counts units and beds apart, and an id once whatever its case; another shell starts again at 1", () => {
    const view = pending();
    expect(unitNamer(az, view, [A], "az").nameOf(A)).toBe("Şöbə 1");
    expect(bedNamer(az, view, [B], "az").nameOf(B)).toBe("Çarpayı 1");
    expect(unitNamer(az, view, [A.toUpperCase()], "az").nameOf(A)).toBe("Şöbə 1");
    expect(unitNamer(az, pending(), [B], "az").nameOf(B)).toBe("Şöbə 1");
  });
});

describe("the beds of a list, named", () => {
  it("by label and unit once known; «unknown bed» for an id the tree lacks", () => {
    const names = bedNamer(az, known(), [BED(5), BED(1), GHOST], "az");
    expect(names.nameOf(BED(5))).toBe("5 · Reanimasiya");
    expect(names.nameOf(GHOST)).toBe(`${az("kabul.bedUnknown")} 1`);
    expect(names.sorted).toEqual([BED(1), BED(5), GHOST]);
  });

  it("by a numbered placeholder while the structure is not known, never as «unknown»", () => {
    const names = bedNamer(az, pending(), [BED(5), "bed-7", BED(1)], "az");
    expect(names.nameOf(BED(5))).toBe("Çarpayı 1");
    expect(names.nameOf(BED(1))).toBe("Çarpayı 2");
    expect(names.nameOf("bed-7")).toBe("bed-7");
  });

  it("keeps the labels a stale tree holds, and numbers a bed it lacks", () => {
    const names = bedNamer(az, viewOf("stale", indexStructure(structure())), [BED(5), GHOST], "az");
    expect(names.nameOf(BED(5))).toBe("5 · Reanimasiya");
    expect(names.nameOf(GHOST)).toBe("Çarpayı 1");
  });

  it("counts its placeholders: the unnamed beds of a stale or unread tree, not a bed called «unknown»", () => {
    expect(bedNamer(az, viewOf("stale", indexStructure(structure())), [BED(5), GHOST], "az").placeholders).toBe(1);
    expect(bedNamer(az, pending(), [BED(5), GHOST, "bed-7"], "az").placeholders).toBe(2);
    expect(bedNamer(az, known(), [BED(5), GHOST], "az").placeholders).toBe(0);
  });
});
